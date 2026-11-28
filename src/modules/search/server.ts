import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { can, effectiveLevel } from "@/lib/permissions";
import { getDocsContext } from "@/modules/docs/access";
import { levelAtLeast } from "@/modules/docs/folder-permissions";
import { isViewable } from "@/modules/docs/markup";
import { issueAccess } from "@/modules/issues/logic";
import { canSeeReview, toStepDef } from "@/modules/reviews/server";
import { canSeeTransmittal, managesTransmittals } from "@/modules/transmittals/server";
import { HEADLINE_OPTIONS, type SearchRequest } from "./logic";

// Global search. Postgres does the matching and ranking (to_tsquery over the
// indexed document text, and over issue/review/transmittal text built on the fly,
// which are small per project); the module's own access rules are then re-applied
// to the candidates, so search never shows anything its page wouldn't.

export class SearchError extends Error {}

type DocsCtx = Awaited<ReturnType<typeof getDocsContext>>;

/** Over-fetch before access filtering, so hidden rows don't empty a page of results. */
const CANDIDATES = 200;

/** Runs a raw query with a statement timeout, turning a bad regex into a readable error. */
async function guarded<T>(query: Prisma.Sql): Promise<T[]> {
  try {
    return await db.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL statement_timeout = 5000`;
      return tx.$queryRaw<T[]>(query);
    }, { timeout: 8000 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (/regular expression/i.test(msg)) throw new SearchError("The database couldn't read that regular expression. Try a simpler pattern.");
    if (/statement timeout|canceling statement/i.test(msg)) throw new SearchError("That search took too long. Add words or simplify the pattern.");
    throw e;
  }
}

const tsq = (r: SearchRequest) => Prisma.sql`to_tsquery('english', ${r.tsQuery ?? ""})`;

/** `AND (name ~* re)`, or its opposite when inverted; nothing when there is no name filter. */
const nameFilter = (r: SearchRequest, column: Prisma.Sql) =>
  r.nameRegex ? (r.invert ? Prisma.sql`AND NOT (${column} ~* ${r.nameRegex})` : Prisma.sql`AND (${column} ~* ${r.nameRegex})`) : Prisma.empty;

/** Text match, number match, or (with only a name filter) everything the name filter keeps. */
function matchClause(r: SearchRequest, vector: Prisma.Sql, numberColumn?: Prisma.Sql) {
  const parts: Prisma.Sql[] = [];
  if (r.tsQuery) parts.push(Prisma.sql`${vector} @@ ${tsq(r)}`);
  if (numberColumn && r.number !== null) parts.push(Prisma.sql`${numberColumn} = ${r.number}`);
  if (!parts.length) return r.nameRegex ? Prisma.empty : Prisma.sql`AND false`;
  return Prisma.sql`AND (${Prisma.join(parts, " OR ")})`;
}

const rankOf = (r: SearchRequest, vector: Prisma.Sql) => (r.tsQuery ? Prisma.sql`ts_rank(${vector}, ${tsq(r)})` : Prisma.sql`0::real`);
const headline = (r: SearchRequest, text: Prisma.Sql) =>
  r.tsQuery ? Prisma.sql`CASE WHEN ${text} <> '' THEN ts_headline('english', ${text}, ${tsq(r)}, ${HEADLINE_OPTIONS}) ELSE NULL END` : Prisma.sql`NULL::text`;

// ---------- documents ----------

export interface DocumentHit {
  id: string;
  name: string;
  folderId: string;
  folderName: string;
  versionId: string;
  version: number;
  viewable: boolean;
  status: string | null;
  method: string | null;
  snippet: string | null;
  inText: boolean;
}

const docNameVector = Prisma.sql`to_tsvector('english', regexp_replace(d."name", '[^[:alnum:]]+', ' ', 'g'))`;

export async function searchDocuments(ctx: DocsCtx, r: SearchRequest, limit: number): Promise<DocumentHit[] | null> {
  if (!can(ctx.member, "DOCS", "view", ctx.grants)) return null;
  const visible = ctx.folders.filter((f) => levelAtLeast(ctx.levelOn(f.id), "VIEW"));
  if (!visible.length) return [];
  const vector = Prisma.sql`coalesce(t."search", ${docNameVector})`;
  const rows = await guarded<Omit<DocumentHit, "folderName" | "viewable"> & { contentType: string }>(Prisma.sql`
    SELECT x."id", x."name", x."folderId", x."versionId", x."version", x."contentType", x."status", x."method", x."inText",
           ${headline(r, Prisma.sql`x."text"`)} AS "snippet"
    FROM (
      SELECT d."id", d."name", d."folderId", d."updatedAt", v."id" AS "versionId", v."number" AS "version", v."contentType",
             t."status"::text AS "status", t."method"::text AS "method", coalesce(t."text", '') AS "text",
             ${r.tsQuery ? Prisma.sql`coalesce(t."search" @@ ${tsq(r)}, false) AND coalesce(t."text", '') <> ''` : Prisma.sql`false`} AS "inText",
             ${rankOf(r, vector)} AS "rank"
      FROM "Document" d
      JOIN "DocumentVersion" v ON v."documentId" = d."id" AND v."number" = d."currentVersion"
      LEFT JOIN "DocumentText" t ON t."versionId" = v."id"
      WHERE d."projectId" = ${ctx.project.id}
        AND d."folderId" IN (${Prisma.join(visible.map((f) => f.id))})
        ${matchClause(r, Prisma.sql`(${docNameVector} || coalesce(t."search", ''::tsvector))`)}
        ${nameFilter(r, Prisma.sql`d."name"`)}
      ORDER BY "rank" DESC, d."updatedAt" DESC
      LIMIT ${limit}
    ) x
    ORDER BY x."rank" DESC, x."updatedAt" DESC`);
  const names = new Map(ctx.folders.map((f) => [f.id, f.name]));
  return rows.map(({ contentType, ...h }) => ({
    ...h,
    folderName: names.get(h.folderId) ?? "",
    viewable: isViewable(contentType, h.name),
    snippet: h.inText ? h.snippet : null,
  }));
}

// ---------- issues ----------

export interface IssueHit {
  id: string;
  number: number;
  title: string;
  status: { name: string; color: string };
  type: string | null;
  snippet: string | null;
}

export async function searchIssues(ctx: DocsCtx, r: SearchRequest, limit: number): Promise<IssueHit[] | null> {
  const level = effectiveLevel(ctx.member, "ISSUES", ctx.grants);
  if (level === "NONE") return null;
  const body = Prisma.sql`(coalesce(i."description", '') || ' ' || coalesce((SELECT string_agg(c."body", ' ') FROM "IssueComment" c WHERE c."issueId" = i."id"), ''))`;
  const vector = Prisma.sql`(setweight(to_tsvector('english', i."title"), 'A') || setweight(to_tsvector('english', ${body}), 'B'))`;
  const rows = await guarded<{ id: string; snippet: string | null }>(Prisma.sql`
    SELECT x."id", ${headline(r, Prisma.sql`x."body"`)} AS "snippet"
    FROM (
      SELECT i."id", i."number", ${body} AS "body", ${rankOf(r, vector)} AS "rank"
      FROM "Issue" i
      WHERE i."projectId" = ${ctx.project.id}
        ${matchClause(r, vector, Prisma.sql`i."number"`)}
        ${nameFilter(r, Prisma.sql`i."title"`)}
      ORDER BY "rank" DESC, i."number" DESC
      LIMIT ${CANDIDATES}
    ) x
    ORDER BY x."rank" DESC, x."number" DESC`);
  if (!rows.length) return [];
  const issues = await db.issue.findMany({
    where: { id: { in: rows.map((x) => x.id) }, projectId: ctx.project.id },
    select: { id: true, number: true, title: true, createdById: true, assigneeType: true, assigneeId: true, status: { select: { name: true, color: true, draft: true } }, type: { select: { name: true } } },
  });
  const byId = new Map(issues.map((i) => [i.id, i]));
  const out: IssueHit[] = [];
  for (const row of rows) {
    const i = byId.get(row.id);
    // drafts stay with their creator and Issues Managers, as on the Issues page
    if (!i || !issueAccess(level, ctx.member, { ...i, draft: i.status.draft }).see) continue;
    out.push({ id: i.id, number: i.number, title: i.title, status: { name: i.status.name, color: i.status.color }, type: i.type?.name ?? null, snippet: row.snippet });
    if (out.length >= limit) break;
  }
  return out;
}

// ---------- reviews ----------

export interface ReviewHit {
  id: string;
  number: number;
  name: string;
  status: string;
  snippet: string | null;
}

export async function searchReviews(ctx: DocsCtx, r: SearchRequest, limit: number): Promise<ReviewHit[] | null> {
  if (!can(ctx.member, "DOCS", "view", ctx.grants)) return null;
  const body = Prisma.sql`(
    coalesce((SELECT string_agg(d."name", ' ') FROM "ReviewDocument" rd JOIN "DocumentVersion" v ON v."id" = rd."versionId" JOIN "Document" d ON d."id" = v."documentId" WHERE rd."reviewId" = rv."id"), '')
    || ' ' || coalesce((SELECT string_agg(rc."comment", ' ') FROM "ReviewDecision" rc WHERE rc."reviewId" = rv."id"), ''))`;
  const vector = Prisma.sql`(setweight(to_tsvector('english', rv."name"), 'A') || setweight(to_tsvector('english', ${body}), 'B'))`;
  const rows = await guarded<{ id: string; snippet: string | null }>(Prisma.sql`
    SELECT x."id", ${headline(r, Prisma.sql`x."body"`)} AS "snippet"
    FROM (
      SELECT rv."id", rv."number", ${body} AS "body", ${rankOf(r, vector)} AS "rank"
      FROM "Review" rv
      WHERE rv."projectId" = ${ctx.project.id}
        ${matchClause(r, vector, Prisma.sql`rv."number"`)}
        ${nameFilter(r, Prisma.sql`rv."name"`)}
      ORDER BY "rank" DESC, rv."number" DESC
      LIMIT ${CANDIDATES}
    ) x
    ORDER BY x."rank" DESC, x."number" DESC`);
  if (!rows.length) return [];
  const reviews = await db.review.findMany({
    where: { id: { in: rows.map((x) => x.id) }, projectId: ctx.project.id },
    select: {
      id: true,
      number: true,
      name: true,
      status: true,
      initiatorId: true,
      workflow: { select: { steps: true } },
      documents: { select: { version: { select: { document: { select: { folderId: true } } } } } },
    },
  });
  const byId = new Map(reviews.map((x) => [x.id, x]));
  const out: ReviewHit[] = [];
  for (const row of rows) {
    const rv = byId.get(row.id);
    if (!rv) continue;
    const steps = rv.workflow.steps.map(toStepDef);
    if (!canSeeReview(ctx, rv.initiatorId, steps, rv.documents.map((d) => d.version.document.folderId))) continue;
    out.push({ id: rv.id, number: rv.number, name: rv.name, status: rv.status, snippet: row.snippet });
    if (out.length >= limit) break;
  }
  return out;
}

// ---------- transmittals ----------

export interface TransmittalHit {
  id: string;
  number: number;
  subject: string;
  snippet: string | null;
}

export async function searchTransmittals(ctx: DocsCtx, r: SearchRequest, limit: number): Promise<TransmittalHit[] | null> {
  if (!can(ctx.member, "DOCS", "view", ctx.grants)) return null;
  const body = Prisma.sql`(
    coalesce(tr."message", '')
    || ' ' || coalesce((SELECT string_agg(td."fileName", ' ') FROM "TransmittalDocument" td WHERE td."transmittalId" = tr."id"), '')
    || ' ' || coalesce((SELECT string_agg(rc."email" || ' ' || coalesce(rc."name", ''), ' ') FROM "TransmittalRecipient" rc WHERE rc."transmittalId" = tr."id"), ''))`;
  const vector = Prisma.sql`(setweight(to_tsvector('english', tr."subject"), 'A') || setweight(to_tsvector('english', ${body}), 'B'))`;
  // non-managers only ever see what they sent or received
  const mine = managesTransmittals(ctx)
    ? Prisma.empty
    : Prisma.sql`AND (tr."senderId" = ${ctx.user.id} OR EXISTS (SELECT 1 FROM "TransmittalRecipient" me WHERE me."transmittalId" = tr."id" AND me."userId" = ${ctx.user.id}))`;
  const rows = await guarded<{ id: string; snippet: string | null }>(Prisma.sql`
    SELECT x."id", ${headline(r, Prisma.sql`x."body"`)} AS "snippet"
    FROM (
      SELECT tr."id", tr."number", ${body} AS "body", ${rankOf(r, vector)} AS "rank"
      FROM "Transmittal" tr
      WHERE tr."projectId" = ${ctx.project.id}
        ${mine}
        ${matchClause(r, vector, Prisma.sql`tr."number"`)}
        ${nameFilter(r, Prisma.sql`tr."subject"`)}
      ORDER BY "rank" DESC, tr."number" DESC
      LIMIT ${CANDIDATES}
    ) x
    ORDER BY x."rank" DESC, x."number" DESC`);
  if (!rows.length) return [];
  const list = await db.transmittal.findMany({
    where: { id: { in: rows.map((x) => x.id) }, projectId: ctx.project.id },
    select: { id: true, number: true, subject: true, senderId: true, recipients: { select: { userId: true } } },
  });
  const byId = new Map(list.map((x) => [x.id, x]));
  const out: TransmittalHit[] = [];
  for (const row of rows) {
    const t = byId.get(row.id);
    if (!t || !canSeeTransmittal(ctx, t)) continue;
    out.push({ id: t.id, number: t.number, subject: t.subject, snippet: row.snippet });
    if (out.length >= limit) break;
  }
  return out;
}

// ---------- index status (admins) ----------

export async function indexStatus(projectId: string) {
  const [groups, problems] = await Promise.all([
    db.documentText.groupBy({ by: ["status"], where: { projectId }, _count: true }),
    db.documentText.findMany({
      where: { projectId, OR: [{ status: "FAILED" }, { error: { not: null } }] },
      select: { id: true, status: true, error: true, version: { select: { fileName: true, number: true } } },
      orderBy: { updatedAt: "desc" },
      take: 10,
    }),
  ]);
  const counts: Record<string, number> = { PENDING: 0, PROCESSING: 0, DONE: 0, FAILED: 0, SKIPPED: 0 };
  for (const g of groups) counts[g.status] = g._count;
  return { counts, problems };
}

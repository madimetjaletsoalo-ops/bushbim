import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { CSV_HEADER, buildIssueWhere, dueDay, issueLabel, listOptions, parseFilters, statusLabel, toCsv } from "@/modules/issues/logic";
import { accessFor, getIssuesContext } from "@/modules/issues/server";

const MAX_ROWS = 10_000;

/** CSV of the issues matching the same filters as the list (query string), for anyone who can view Issues. */
export async function GET(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const ctx = await getIssuesContext(projectId);
  if (!ctx.canView) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const f = parseFilters(Object.fromEntries(new URL(req.url).searchParams.entries()));
  // repeated keys (type, status) need getAll
  const sp = new URL(req.url).searchParams;
  f.typeIds = parseFilters({ type: sp.getAll("type") }).typeIds;
  f.statusIds = parseFilters({ status: sp.getAll("status") }).statusIds;
  const where = buildIssueWhere(projectId, f, {
    statuses: ctx.statuses,
    attributes: ctx.attributes,
    timeZone: ctx.project.timezone,
    userId: ctx.user.id,
    manager: ctx.canManage,
  }) as Prisma.IssueWhereInput;
  const issues = await db.issue.findMany({
    where,
    include: { status: true, type: true, subtype: true, rootCause: true, createdBy: { select: { name: true } } },
    orderBy: { number: "asc" },
    take: MAX_ROWS,
  });
  const loc = new Map(ctx.locationPaths.map((l) => [l.id, l.path]));
  const stamp = new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeStyle: "short", timeZone: ctx.project.timezone });
  const rows = issues
    .filter((i) => accessFor(ctx, i).see)
    .map((i) => {
      const attrs = (i.attributes && typeof i.attributes === "object" ? i.attributes : {}) as Record<string, string>;
      return [
        issueLabel(i.number),
        i.title,
        i.type?.name,
        i.subtype?.name,
        statusLabel(i.status, ctx.statuses),
        ctx.assigneeName(i.assigneeType, i.assigneeId),
        i.dueDate ? dueDay(i.dueDate) : "",
        i.locationId ? loc.get(i.locationId) : "",
        i.rootCause?.name,
        i.createdBy?.name,
        stamp.format(i.createdAt),
        i.description,
        ...ctx.attributes.map((a) => (a.kind !== "LIST" || listOptions(a.options).includes(attrs[a.id]) ? attrs[a.id] : "")),
      ];
    });
  const csv = toCsv([[...CSV_HEADER, ...ctx.attributes.map((a) => a.name)], ...rows]);
  const name = `${(ctx.project.code || ctx.project.name).replace(/[^\w.-]+/g, "-").slice(0, 40)}-issues.csv`;
  return new NextResponse("﻿" + csv, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" },
  });
}

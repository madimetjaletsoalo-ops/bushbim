import "server-only";
import { db } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { extractText } from "./extract";
import { MAX_INDEX_BYTES, MAX_ATTEMPTS, STALE_JOB_MS, extractorFor, statusAfterFailure } from "./logic";
import { startOcr, type Ocr } from "./ocr";

// Background text indexing. Each document version gets a DocumentText row (a job);
// runIndexJobs claims PENDING rows one at a time (SKIP LOCKED, so several runs can
// share the queue), extracts the text and writes the tsvector.
// Runs are started after an upload (next/server `after`), by the cron route
// /api/jobs/index-text, and by project admins from the search page.

/** Queues a version for indexing (again, if it was indexed before). */
export async function queueVersion(projectId: string, versionId: string) {
  await db.documentText.upsert({
    where: { versionId },
    create: { projectId, versionId },
    update: { status: "PENDING", attempts: 0, error: null, startedAt: null },
  });
}

/** Queues the latest version of every document in a project. Returns how many. */
export async function queueProject(projectId: string) {
  const docs = await db.document.findMany({ where: { projectId }, select: { currentVersion: true, versions: { select: { id: true, number: true } } } });
  const ids = docs.map((d) => d.versions.find((v) => v.number === d.currentVersion)?.id).filter((x): x is string => !!x);
  await db.$transaction([
    db.documentText.updateMany({ where: { projectId, versionId: { in: ids } }, data: { status: "PENDING", attempts: 0, error: null, startedAt: null } }),
    db.documentText.createMany({ data: ids.map((versionId) => ({ projectId, versionId })), skipDuplicates: true }),
  ]);
  return ids.length;
}

type Job = { id: string; versionId: string; attempts: number };

async function claim(projectId: string | null): Promise<Job | null> {
  const stale = new Date(Date.now() - STALE_JOB_MS);
  // jobs that died mid-run too often are given up on
  await db.documentText.updateMany({
    where: { status: "PROCESSING", startedAt: { lt: stale }, attempts: { gte: MAX_ATTEMPTS }, ...(projectId ? { projectId } : {}) },
    data: { status: "FAILED", error: "Timed out while reading the file" },
  });
  const rows = await db.$queryRaw<Job[]>`
    UPDATE "DocumentText" SET "status" = 'PROCESSING', "attempts" = "attempts" + 1, "startedAt" = now(), "updatedAt" = now()
    WHERE "id" = (
      SELECT "id" FROM "DocumentText"
      WHERE ("status" = 'PENDING' OR ("status" = 'PROCESSING' AND "startedAt" < ${stale}))
        AND "attempts" < ${MAX_ATTEMPTS}
        AND (${projectId}::text IS NULL OR "projectId" = ${projectId})
      ORDER BY "createdAt"
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id", "versionId", "attempts"`;
  return rows[0] ?? null;
}

/** Words of the file name, so "KLV-ARC-101_Plan.pdf" indexes as klv, arc, 101, plan, pdf. */
const nameWords = (fileName: string) => fileName.replace(/[^\p{L}\p{N}]+/gu, " ");

async function writeResult(
  job: Job,
  fileName: string,
  data: { status: "DONE" | "SKIPPED"; method: "PDF_TEXT" | "OCR" | "DOCX" | "XLSX" | "TEXT" | "NONE"; text: string; pages?: number; note?: string },
) {
  const update = async (cap: number) =>
    db.$transaction([
      db.documentText.update({
        where: { id: job.id },
        data: { status: data.status, method: data.method, text: data.text, chars: data.text.length, pages: data.pages ?? null, error: data.note ?? null, indexedAt: new Date() },
      }),
      db.$executeRaw`
        UPDATE "DocumentText"
        SET "search" = setweight(to_tsvector('english', ${nameWords(fileName)}), 'A') || setweight(to_tsvector('english', left("text", ${cap}::int)), 'B')
        WHERE "id" = ${job.id}`,
    ]);
  try {
    await update(200_000);
  } catch {
    // a tsvector is capped at 1 MB; very word-dense text gets a shorter index
    await update(50_000);
  }
}

async function processJob(job: Job, ocr: () => Promise<Ocr>) {
  const v = await db.documentVersion.findUnique({ where: { id: job.versionId }, select: { storageKey: true, fileName: true, contentType: true, size: true } });
  if (!v) {
    await db.documentText.deleteMany({ where: { id: job.id } });
    return;
  }
  if (!extractorFor(v.fileName, v.contentType)) return writeResult(job, v.fileName, { status: "SKIPPED", method: "NONE", text: "" });
  if (v.size > MAX_INDEX_BYTES) return writeResult(job, v.fileName, { status: "SKIPPED", method: "NONE", text: "", note: "File too large to read; indexed by name" });
  try {
    const bytes = await getStorage().read(v.storageKey);
    const r = await extractText(bytes, v.fileName, v.contentType, ocr);
    await writeResult(job, v.fileName, { status: "DONE", ...r });
  } catch (e) {
    console.error("search: couldn't index", v.fileName, e);
    const message = e instanceof Error ? e.message.slice(0, 300) : "Couldn't read the file";
    await db.documentText.update({ where: { id: job.id }, data: { status: statusAfterFailure(job.attempts), error: message, startedAt: null } });
  }
}

let running: Promise<number> | null = null;
let again = false;

/**
 * Indexes queued versions until the queue is empty, `limit` jobs are done or the time
 * budget runs out. One run per server process: a second call while one is running
 * just asks it to look at the queue again. Returns how many jobs this call processed.
 */
export async function runIndexJobs(opts: { projectId?: string; limit?: number; budgetMs?: number } = {}): Promise<number> {
  if (running && !opts.projectId) {
    again = true;
    return 0;
  }
  const work = async () => {
    const limit = opts.limit ?? 50;
    const deadline = Date.now() + (opts.budgetMs ?? 45_000);
    let engine: Ocr | null = null;
    const ocr = async () => (engine ??= await startOcr());
    let done = 0;
    try {
      do {
        again = false;
        while (done < limit && Date.now() < deadline) {
          const job = await claim(opts.projectId ?? null);
          if (!job) break;
          await processJob(job, ocr);
          done++;
        }
      } while (again && done < limit && Date.now() < deadline);
    } finally {
      await (engine as Ocr | null)?.close();
    }
    return done;
  };
  if (opts.projectId) return work();
  running = work();
  try {
    return await running;
  } finally {
    running = null;
  }
}

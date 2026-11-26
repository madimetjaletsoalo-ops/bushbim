import { timingSafeEqual } from "node:crypto";
import { runIndexJobs } from "@/modules/search/indexer";

// Background text indexing for every project, run by the scheduler (vercel.json crons)
// with `Authorization: Bearer $CRON_SECRET`. Uploads also start a run right away.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorised(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return given.length === want.length && timingSafeEqual(given, want);
}

export async function GET(req: Request) {
  if (!authorised(req)) return new Response("Unauthorised", { status: 401 });
  const indexed = await runIndexJobs({ limit: 100, budgetMs: 50_000 });
  return Response.json({ indexed });
}

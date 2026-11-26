"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireProjectAdmin } from "@/lib/auth";
import type { ActionState } from "@/modules/admin/types";
import { queueProject, runIndexJobs } from "./indexer";

const projectIdSchema = z.string().min(1).max(64);
const runSchema = z.object({ scope: z.enum(["pending", "all"]) });

/**
 * Project admins: index this project's queued files now ("pending"), or queue the latest
 * version of every document again and index them ("all", e.g. after OCR was turned on).
 * Whatever doesn't fit in the time budget is left for the next run.
 */
export async function runProjectIndex(projectId: string, _: ActionState, form: FormData): Promise<ActionState> {
  if (!projectIdSchema.safeParse(projectId).success) return { error: "Unknown project." };
  const ctx = await requireProjectAdmin(projectId);
  const parsed = runSchema.safeParse({ scope: form.get("scope") });
  if (!parsed.success) return { error: "Choose what to index." };
  const queued = parsed.data.scope === "all" ? await queueProject(projectId) : null;
  await db.auditEvent.create({
    data: { actorId: ctx.user.id, projectId, action: parsed.data.scope === "all" ? "search.reindexed" : "search.index_run", details: queued !== null ? { queued } : {} },
  });
  const done = await runIndexJobs({ projectId, limit: 40, budgetMs: 40_000 });
  const left = await db.documentText.count({ where: { projectId, status: { in: ["PENDING", "PROCESSING"] } } });
  revalidatePath(`/projects/${projectId}/search`);
  const files = (n: number) => `${n} file${n === 1 ? "" : "s"}`;
  return { ok: true, message: `Indexed ${files(done)}.${left ? ` ${files(left)} still queued; they'll be picked up by the next run.` : ""}` };
}

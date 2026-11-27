import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { LIMITS, normaliseAnswer, statusAfterAnswer } from "./logic";
import { accessFor, type ChecklistsContext } from "./server";

// Loading a checklist for an action, and answering one item: shared by the checklist
// actions and by offline sync.

const idSchema = z.string().min(1).max(64);

export async function loadChecklist(ctx: ChecklistsContext, checklistId: string) {
  if (!idSchema.safeParse(checklistId).success) return null;
  const checklist = await db.checklist.findFirst({
    where: { id: checklistId, projectId: ctx.project.id },
    include: { items: { include: { section: { select: { title: true } }, _count: { select: { photos: true } } } } },
  });
  return checklist ? { checklist, access: accessFor(ctx, checklist) } : null;
}
export type LoadedChecklist = NonNullable<Awaited<ReturnType<typeof loadChecklist>>>;

export const ANSWER_ERRORS = {
  notFound: "Checklist not found.",
  completed: "This checklist is completed. Reopen it to change answers.",
  notAllowed: "Only the assignee, the checklist's creator or a Checklists Manager can answer it.",
  noItem: "Item not found.",
};

/**
 * Answers (or, with a blank value, clears) one item; `note` undefined keeps the current note.
 * Re-checks access, validates the value for the item's kind and writes an AuditEvent.
 */
export async function applyAnswer(
  ctx: ChecklistsContext,
  found: LoadedChecklist | null,
  itemId: string,
  rawValue: string,
  rawNote: string | undefined,
  audit: Record<string, string> = {},
): Promise<{ ok: true; changed: boolean; message: string } | { ok: false; error: string }> {
  if (!found?.access.see) return { ok: false, error: ANSWER_ERRORS.notFound };
  if (!found.access.answer) return { ok: false, error: found.checklist.status === "COMPLETED" ? ANSWER_ERRORS.completed : ANSWER_ERRORS.notAllowed };
  const item = found.checklist.items.find((i) => i.id === itemId);
  if (!item) return { ok: false, error: ANSWER_ERRORS.noItem };
  const answer = normaliseAnswer(item.kind, rawValue);
  if ("error" in answer) return { ok: false, error: answer.error };
  const note = rawNote !== undefined ? rawNote.trim().slice(0, LIMITS.note) || null : item.note;
  if (answer.value === item.value && note === item.note) return { ok: true, changed: false, message: "No changes." };
  const c = found.checklist;
  await db.$transaction([
    db.checklistItem.update({
      where: { id: item.id },
      data: { value: answer.value, note, answeredById: answer.value ? ctx.user.id : null, answeredAt: answer.value ? new Date() : null },
    }),
    db.checklist.update({ where: { id: c.id }, data: { status: statusAfterAnswer(c.status) } }),
    db.auditEvent.create({
      data: {
        actorId: ctx.user.id,
        projectId: ctx.project.id,
        action: answer.value ? "checklist.item_answered" : "checklist.item_cleared",
        // signatures are not copied into the log
        details: { checklistId: c.id, number: c.number, itemId: item.id, item: item.label, value: item.kind === "SIGNATURE" && answer.value ? "signed" : answer.value, ...audit },
      },
    }),
  ]);
  return { ok: true, changed: true, message: answer.value ? "Saved." : "Answer cleared." };
}

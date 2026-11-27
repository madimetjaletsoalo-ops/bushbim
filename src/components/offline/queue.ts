// Turning a form submitted offline into an outbox change.
import { formPairs, issueTitleOf } from "@/modules/offline/logic";
import { addChange, newClientId, offlineUser } from "./outbox";

/** What an offline-capable form does when there is no connection. Plain data, so a server page can pass it. */
export type OfflineIntent =
  | { kind: "issue.create"; projectId: string }
  | { kind: "checklist.answer"; projectId: string; checklistId: string; itemId: string; label: string; base: { value: string | null; note: string | null } };

export const OFFLINE_SAVED = "Saved on this device. It will sync when you're back online.";

/** Stores the form as a change; returns its id, or null when nobody is signed in on this device. */
export async function queueForm(intent: OfflineIntent, form: FormData): Promise<string | null> {
  const userId = offlineUser();
  if (!userId) return null;
  const clientId = newClientId();
  const madeAt = new Date().toISOString();
  if (intent.kind === "issue.create") {
    const fields = formPairs(form.entries());
    await addChange({
      clientId,
      projectId: intent.projectId,
      userId,
      kind: "issue.create",
      label: issueTitleOf(fields),
      href: `/projects/${intent.projectId}/issues`,
      change: { kind: "issue.create", clientId, madeAt, fields },
    });
    return clientId;
  }
  const value = form.get("value");
  const note = form.get("note");
  const entry = await addChange({
    clientId,
    projectId: intent.projectId,
    userId,
    kind: "checklist.answer",
    label: intent.label,
    href: `/projects/${intent.projectId}/checklists/${intent.checklistId}`,
    change: {
      kind: "checklist.answer",
      clientId,
      madeAt,
      checklistId: intent.checklistId,
      itemId: intent.itemId,
      value: typeof value === "string" ? value : "",
      ...(typeof note === "string" ? { note } : {}),
      base: intent.base,
    },
  });
  return entry.clientId;
}

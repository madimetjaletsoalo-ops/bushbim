import "server-only";
import { issueSchema, parseAssignee, validateAttributes, type IssueInput } from "./logic";
import { db } from "@/lib/db";
import { actorOf, issueAssigned } from "@/modules/notifications/events";
import { readPinFields } from "./media";
import { pinTarget } from "./media-server";
import { createIssueRow, type IssuesContext } from "./server";

// The issue form, shared by the create/edit actions and by offline sync.

export const str = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
};
const strings = (form: FormData, key: string) => [...new Set(form.getAll(key).filter((x): x is string => typeof x === "string" && !!x))];

export type Resolved = {
  data: {
    title: string;
    description: string | null;
    typeId: string | null;
    subtypeId: string | null;
    assigneeType: "USER" | "ROLE" | "COMPANY" | null;
    assigneeId: string | null;
    dueDate: Date | null;
    locationId: string | null;
    rootCauseId: string | null;
    attributes: Record<string, string>;
  };
  statusId: string | null;
  watcherIds: string[];
};

/** Validates the issue form and checks that every referenced type, status, person and place belongs to this project. */
export function resolveIssueForm(ctx: IssuesContext, form: FormData, existing?: { typeId: string | null; subtypeId: string | null }): Resolved | { error: string } {
  const parsed = issueSchema.safeParse({
    title: str(form, "title"),
    description: str(form, "description"),
    typeId: str(form, "typeId"),
    subtypeId: str(form, "subtypeId"),
    statusId: str(form, "statusId"),
    assignee: str(form, "assignee"),
    dueDate: str(form, "dueDate"),
    locationId: str(form, "locationId"),
    rootCauseId: str(form, "rootCauseId"),
    watcherIds: strings(form, "watcherIds"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const v: IssueInput = parsed.data;

  // a deactivated type or subtype may stay on an issue that already has it, but can't be newly chosen
  const type = v.typeId ? ctx.types.find((t) => t.id === v.typeId && (t.active || t.id === existing?.typeId)) : null;
  if (v.typeId && !type) return { error: "Choose a type from the list." };
  const subtype = v.subtypeId ? type?.subtypes.find((s) => s.id === v.subtypeId && (s.active || s.id === existing?.subtypeId)) : null;
  if (v.subtypeId && !subtype) return { error: "That subtype doesn't belong to the chosen type." };
  if (v.statusId && !ctx.statuses.some((s) => s.id === v.statusId)) return { error: "Choose a status from the list." };
  const assignee = v.assignee ? parseAssignee(v.assignee) : null;
  if (v.assignee && (!assignee || !ctx.isAssignee(v.assignee))) return { error: "Assign the issue to a project member, a role or a company." };
  if (v.locationId && !ctx.locations.some((l) => l.id === v.locationId)) return { error: "Choose a location from the list." };
  if (v.rootCauseId && !ctx.rootCauses.some((r) => r.id === v.rootCauseId)) return { error: "Choose a root cause from the list." };
  const memberIds = new Set(ctx.members.map((m) => m.userId));
  if (v.watcherIds.some((id) => !memberIds.has(id))) return { error: "Watchers must be project members." };

  const attrs = validateAttributes(
    ctx.attributes,
    Object.fromEntries(ctx.attributes.map((a) => [a.id, str(form, `attr_${a.id}`)])),
  );
  if ("error" in attrs) return attrs;

  return {
    data: {
      title: v.title,
      description: v.description || null,
      typeId: type?.id ?? null,
      subtypeId: subtype?.id ?? null,
      assigneeType: assignee?.type ?? null,
      assigneeId: assignee?.id ?? null,
      dueDate: v.dueDate,
      locationId: v.locationId,
      rootCauseId: v.rootCauseId,
      attributes: attrs.values,
    },
    statusId: v.statusId,
    watcherIds: v.watcherIds,
  };
}


/**
 * Creates an issue from the issue form: checks Creator access, every field and an optional pin,
 * writes the AuditEvents and notifies the assignee. Used by the form and by offline sync.
 */
export async function createIssueFromForm(ctx: IssuesContext, form: FormData): Promise<{ ok: true; issue: { id: string; number: number } } | { ok: false; error: string }> {
  if (!ctx.canCreate) return { ok: false, error: "Creating issues needs Issues Creator access." };
  const projectId = ctx.project.id;
  const r = resolveIssueForm(ctx, form);
  if ("error" in r) return { ok: false, error: r.error };
  const status = ctx.statuses.find((s) => s.id === r.statusId) ?? ctx.statuses.find((s) => s.isDefault) ?? ctx.statuses.find((s) => !s.draft && !s.closed);
  if (!status) return { ok: false, error: "This project has no issue statuses. Ask a Manager to add one." };
  // "New issue here" from the viewer carries a pin position
  const pin = readPinFields((k) => str(form, k));
  if (pin && "error" in pin) return { ok: false, error: pin.error };
  const target = pin ? await pinTarget(projectId, pin.versionId) : null;
  if (pin && !target) return { ok: false, error: "You can't open the sheet this pin is on." };
  const issue = await createIssueRow(
    {
      projectId,
      ...r.data,
      statusId: status.id,
      createdById: ctx.user.id,
      closedAt: status.closed ? new Date() : null,
      ...(pin ? { pin: { create: { versionId: pin.versionId, page: pin.page, x: pin.x, y: pin.y, createdById: ctx.user.id } } } : {}),
    },
    // the creator watches their own issue
    [...new Set([ctx.user.id, ...r.watcherIds])],
    ctx.user.id,
  );
  if (pin && target)
    await db.auditEvent.create({
      data: {
        actorId: ctx.user.id,
        projectId,
        action: "issue.pinned",
        details: { issueId: issue.id, number: issue.number, versionId: pin.versionId, document: target.document.name, page: pin.page, moved: false },
      },
    });
  await issueAssigned(actorOf(ctx), { id: issue.id, number: issue.number, title: issue.title, assigneeType: issue.assigneeType, assigneeId: issue.assigneeId });
  return { ok: true, issue };
}

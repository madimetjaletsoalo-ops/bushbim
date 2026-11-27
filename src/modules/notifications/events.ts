import "server-only";
import { db } from "@/lib/db";
import { issueLabel } from "@/modules/issues/logic";
import { assigneeUserIds } from "./logic";
import { notify, projectMembersForNotify } from "./server";

// The events that send a notification. Each one is called after its change has been saved.

type Actor = { projectId: string; projectName: string; actorId: string; actorName: string };
type Assignee = { assigneeType: "USER" | "ROLE" | "COMPANY" | null; assigneeId: string | null };

export async function issueAssigned(a: Actor, issue: { id: string; number: number; title: string } & Assignee) {
  if (!issue.assigneeType) return;
  const members = await projectMembersForNotify(a.projectId);
  await notify({
    projectId: a.projectId,
    actorId: a.actorId,
    userIds: assigneeUserIds({ type: issue.assigneeType, id: issue.assigneeId }, members),
    kind: "issue.assigned",
    title: `${issueLabel(issue.number)} assigned to you`,
    body: `${a.actorName} assigned "${issue.title}" to you on ${a.projectName}.`,
    link: `/projects/${a.projectId}/issues/${issue.id}`,
  });
}

/** Watchers and the creator of an issue. */
async function followers(issueId: string) {
  const issue = await db.issue.findUnique({ where: { id: issueId }, select: { createdById: true, watchers: { select: { userId: true } } } });
  return issue ? [issue.createdById, ...issue.watchers.map((w) => w.userId)] : [];
}

export async function issueStatusChanged(a: Actor, issue: { id: string; number: number; title: string }, from: string, to: string) {
  await notify({
    projectId: a.projectId,
    actorId: a.actorId,
    userIds: await followers(issue.id),
    kind: "issue.status_changed",
    title: `${issueLabel(issue.number)} is now ${to}`,
    body: `${a.actorName} moved "${issue.title}" from ${from} to ${to} on ${a.projectName}.`,
    link: `/projects/${a.projectId}/issues/${issue.id}`,
  });
}

export async function issueCommented(a: Actor, issue: { id: string; number: number; title: string }, comment: string) {
  await notify({
    projectId: a.projectId,
    actorId: a.actorId,
    userIds: await followers(issue.id),
    kind: "issue.commented",
    title: `New comment on ${issueLabel(issue.number)}`,
    body: `${a.actorName} on "${issue.title}": ${comment}`,
    link: `/projects/${a.projectId}/issues/${issue.id}`,
  });
}

export async function checklistAssigned(a: Actor, c: { id: string; number: number; title: string } & Assignee) {
  if (!c.assigneeType) return;
  const members = await projectMembersForNotify(a.projectId);
  await notify({
    projectId: a.projectId,
    actorId: a.actorId,
    userIds: assigneeUserIds({ type: c.assigneeType, id: c.assigneeId }, members),
    kind: "checklist.assigned",
    title: `Checklist CL-${c.number} assigned to you`,
    body: `${a.actorName} assigned "${c.title}" to you on ${a.projectName}.`,
    link: `/projects/${a.projectId}/checklists/${c.id}`,
  });
}

export const actorOf = (ctx: { project: { id: string; name: string }; user: { id: string; name: string } }): Actor => ({
  projectId: ctx.project.id,
  projectName: ctx.project.name,
  actorId: ctx.user.id,
  actorName: ctx.user.name,
});

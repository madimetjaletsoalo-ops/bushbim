import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { badge, btnDanger, btnGhost, card, input, label, td, th } from "@/components/ui";
import { db } from "@/lib/db";
import type { MemberContext, ServiceKey } from "@/lib/permissions";
import { getDocsContext } from "@/modules/docs/access";
import { removeFolderPermission, setFolderPermission } from "@/modules/docs/actions";
import {
  DEFAULT_SUBJECT_ID,
  FOLDER_LEVELS,
  FOLDER_LEVEL_HELP,
  FOLDER_LEVEL_LABELS,
  accessReport,
  alwaysManages,
  folderLevel,
  type FolderLevel,
  type FolderSubjectType,
} from "@/modules/docs/folder-permissions";

const levelBadge: Record<FolderLevel, string> = {
  NONE: "bg-red-50 text-red-800",
  VIEW: "bg-muted text-ink",
  VIEW_DOWNLOAD: "bg-muted text-ink",
  UPLOAD: "bg-sky-100 text-sky-900",
  EDIT: "bg-amber-100 text-amber-900",
  MANAGE: "bg-emerald-100 text-emerald-900",
};

/** Folder settings: who has access, grant/override form, and each member's resulting level. Shown to Managers only. */
export async function FolderPermissions({ projectId, folderId }: { projectId: string; folderId: string }) {
  const ctx = await getDocsContext(projectId);
  const [members, roles, companies] = await Promise.all([
    db.projectMember.findMany({
      where: { projectId },
      include: { user: { select: { name: true, email: true, accountRole: true } }, roles: true, company: { select: { name: true } } },
      orderBy: { user: { name: "asc" } },
    }),
    db.role.findMany({ where: { accountId: ctx.user.accountId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.company.findMany({ where: { accountId: ctx.user.accountId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const names: Record<string, string> = {};
  for (const m of members) names[`USER:${m.userId}`] = m.user.name;
  for (const r of roles) names[`ROLE:${r.id}`] = r.name;
  for (const c of companies) names[`COMPANY:${c.id}`] = c.name;
  const kind: Record<FolderSubjectType, string> = { DEFAULT: "", USER: "User", ROLE: "Role", COMPANY: "Company" };

  const report = accessReport(ctx.index, folderId);
  const hasDefault = report.some((r) => r.subjectType === "DEFAULT");
  const folderName = ctx.index.byId.get(folderId)?.name ?? "";

  const memberRows = members
    .map((m) => {
      const mc: MemberContext = {
        userId: m.userId,
        accessLevel: m.accessLevel,
        isAccountAdmin: m.user.accountRole === "ACCOUNT_ADMIN",
        companyId: m.companyId,
        roleIds: m.roles.map((r) => r.roleId),
        services: m.services as ServiceKey[],
      };
      return { m, level: folderLevel(mc, ctx.grants, ctx.index, folderId), always: alwaysManages(mc, ctx.grants) };
    })
    .filter((r) => r.m.services.includes("DOCS") || r.always);

  return (
    <details className={`${card} group`} data-testid="folder-permissions">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-semibold">
        <span>Permissions · who can access “{folderName}”</span>
        <span aria-hidden className="text-ink-soft group-open:rotate-180">▾</span>
      </summary>
      <div className="space-y-5 border-t border-line p-4">
        <div>
          <table className="w-full table-fixed sm:table-auto" data-testid="access-table">
            <thead className="border-b border-line bg-muted/50">
              <tr>
                <th className={th}>Who</th>
                <th className={`${th} w-28 sm:w-auto`}>Level</th>
                <th className={`${th} hidden sm:table-cell`}>Source</th>
                <th className={`${th} w-20 sm:w-auto`}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {!hasDefault && (
                <tr>
                  <td className={`${td} break-words`}>
                    <span className="font-medium">Project members (default)</span>
                    <p className="mt-1 text-xs text-ink-soft sm:hidden">Project default</p>
                  </td>
                  <td className={`${td} break-words`}>Viewer → View + Download, Creator → Edit</td>
                  <td className={`${td} hidden text-ink-soft sm:table-cell`}>Project default</td>
                  <td className={td} />
                </tr>
              )}
              {report.map((r) => {
                const key = `${r.subjectType}:${r.subjectId}`;
                return (
                  <tr key={key}>
                    <td className={`${td} break-words`}>
                      <span className="font-medium">{r.subjectType === "DEFAULT" ? "Project members (default)" : (names[key] ?? "Removed")}</span>
                      {kind[r.subjectType] && <span className="block text-xs text-ink-soft sm:ml-2 sm:inline">{kind[r.subjectType]}</span>}
                      <p className="mt-1 text-xs text-ink-soft sm:hidden">{r.inheritedFrom ? `Inherited from ${r.inheritedFrom.name}` : "Set here"}</p>
                    </td>
                    <td className={td}><span className={`${badge} ${levelBadge[r.level]}`}>{FOLDER_LEVEL_LABELS[r.level]}</span></td>
                    <td className={`${td} hidden text-ink-soft sm:table-cell`}>{r.inheritedFrom ? `Inherited from ${r.inheritedFrom.name}` : "Set here"}</td>
                    <td className={`${td} text-right`}>
                      {!r.inheritedFrom && (
                        <form action={removeFolderPermission.bind(null, projectId, folderId, key)}>
                          <button className={btnDanger} aria-label={`Remove grant for ${r.subjectType === "DEFAULT" ? "project members" : names[key]}`}>Remove</button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
              <tr>
                <td className={`${td} break-words`}>
                  <span className="font-medium">Project admins and Document Control managers</span>
                  <p className="mt-1 text-xs text-ink-soft sm:hidden">Always</p>
                </td>
                <td className={td}><span className={`${badge} ${levelBadge.MANAGE}`}>Manage</span></td>
                <td className={`${td} hidden text-ink-soft sm:table-cell`}>Always</td>
                <td className={td} />
              </tr>
            </tbody>
          </table>
        </div>

        <ActionForm action={setFolderPermission.bind(null, projectId, folderId)} className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end" testId="folder-grant-form">
          <div>
            <label className={label} htmlFor="fp-subject">Grant to</label>
            <select className={input} id="fp-subject" name="subject" required defaultValue="">
              <option value="" disabled>Choose…</option>
              <option value={`DEFAULT:${DEFAULT_SUBJECT_ID}`}>Project members (default)</option>
              <optgroup label="Companies">{companies.map((c) => <option key={c.id} value={`COMPANY:${c.id}`}>{c.name}</option>)}</optgroup>
              <optgroup label="Roles">{roles.map((r) => <option key={r.id} value={`ROLE:${r.id}`}>{r.name}</option>)}</optgroup>
              <optgroup label="People">{members.map((m) => <option key={m.userId} value={`USER:${m.userId}`}>{m.user.name}</option>)}</optgroup>
            </select>
          </div>
          <div>
            <label className={label} htmlFor="fp-level">Level</label>
            <select className={input} id="fp-level" name="level" defaultValue="VIEW_DOWNLOAD">
              {FOLDER_LEVELS.map((l) => (
                <option key={l} value={l}>{FOLDER_LEVEL_LABELS[l]} · {FOLDER_LEVEL_HELP[l]}</option>
              ))}
            </select>
          </div>
          <SubmitButton>Save</SubmitButton>
        </ActionForm>
        <p className="text-xs text-ink-soft">
          Grants apply to this folder and its subfolders, unless a subfolder sets its own. Set “Project members” to “No access” to make a folder private, then grant the people, roles or companies who need it.
        </p>

        <details>
          <summary className={`${btnGhost} cursor-pointer list-none`}>Check each member’s access ({memberRows.length})</summary>
          <ul className="mt-3 divide-y divide-line text-sm" data-testid="member-access">
            {memberRows.map(({ m, level, always }) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <span className="font-medium">{m.user.name}</span>
                  <span className="ml-2 text-xs text-ink-soft">{m.company?.name ?? "No company"}</span>
                </span>
                <span className={`${badge} ${levelBadge[level]}`}>{FOLDER_LEVEL_LABELS[level]}{always ? " (always)" : ""}</span>
              </li>
            ))}
          </ul>
        </details>
      </div>
    </details>
  );
}

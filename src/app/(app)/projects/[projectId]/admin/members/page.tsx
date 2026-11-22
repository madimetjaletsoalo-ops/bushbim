import { ActionForm } from "@/components/ActionForm";
import { CopyButton } from "@/components/CopyButton";
import { MemberFields } from "@/components/MemberFields";
import { SubmitButton } from "@/components/SubmitButton";
import { badge, btnDanger, card, input, label, td, th } from "@/components/ui";
import { db } from "@/lib/db";
import { requireProjectAdmin } from "@/lib/auth";
import { SERVICE_LABELS, type ServiceKey } from "@/lib/permissions";
import { addMember, bulkInvite, removeMember, updateMember } from "@/modules/admin/actions";

export default async function MembersPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ q?: string }> }) {
  const { projectId } = await params;
  const { q = "" } = await searchParams;
  const { user } = await requireProjectAdmin(projectId);
  const [members, companies, roles] = await Promise.all([
    db.projectMember.findMany({
      where: {
        projectId,
        ...(q && {
          OR: [
            { user: { name: { contains: q, mode: "insensitive" } } },
            { user: { email: { contains: q, mode: "insensitive" } } },
            { company: { name: { contains: q, mode: "insensitive" } } },
          ],
        }),
      },
      include: { user: true, company: true, roles: { include: { role: true } } },
      orderBy: { user: { name: "asc" } },
    }),
    db.company.findMany({ where: { accountId: user.accountId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.role.findMany({ where: { accountId: user.accountId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Members</h2>
        <form className="w-full sm:w-72" role="search">
          <input className={input} name="q" defaultValue={q} placeholder="Search name, email or company" aria-label="Search members" />
        </form>
      </div>

      <div className={`${card} overflow-x-auto`}>
        <table className="w-full min-w-[760px]" data-testid="members-table">
          <thead className="border-b border-line bg-muted/50">
            <tr>
              <th className={th}>Name</th>
              <th className={th}>Company</th>
              <th className={th}>Role</th>
              <th className={th}>Access</th>
              <th className={th}>Services</th>
              <th className={th}>Status</th>
              <th className={th}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {members.length === 0 && (
              <tr><td className={`${td} text-ink-soft`} colSpan={7}>No members match.</td></tr>
            )}
            {members.map((m) => (
              <tr key={m.id}>
                <td className={td}>
                  <div className="font-medium">{m.user.name}</div>
                  <div className="text-xs text-ink-soft">{m.user.email}</div>
                </td>
                <td className={td}>{m.company?.name ?? "—"}</td>
                <td className={td}>{m.roles.map((r) => r.role.name).join(", ") || "—"}</td>
                <td className={td}>{m.accessLevel === "PROJECT_ADMIN" ? "Project admin" : "Member"}</td>
                <td className={`${td} text-xs`}>{(m.services as ServiceKey[]).map((s) => SERVICE_LABELS[s]).join(", ") || "—"}</td>
                <td className={td}>
                  <span className={`${badge} ${m.status === "ACTIVE" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                    {m.status === "ACTIVE" ? "Active" : "Invited"}
                  </span>
                  {m.status === "INVITED" && m.user.inviteToken && (
                    <div className="mt-1"><CopyButton path={`/invite/${m.user.inviteToken}`} /></div>
                  )}
                </td>
                <td className={`${td} whitespace-nowrap`}>
                  <details className="group relative">
                    <summary className="cursor-pointer list-none text-sm font-medium text-brand hover:underline">Edit</summary>
                    <div className={`${card} absolute right-0 z-10 mt-2 w-[min(90vw,26rem)] p-4`}>
                      <ActionForm action={updateMember.bind(null, projectId, m.id)} className="space-y-3" resetOnSuccess={false}>
                        <input type="hidden" name="name" value={m.user.name} />
                        <MemberFields
                          idPrefix={`edit-${m.id}`}
                          companies={companies}
                          roles={roles}
                          defaults={{ companyId: m.companyId, roleIds: m.roles.map((r) => r.roleId), accessLevel: m.accessLevel, services: m.services }}
                        />
                        <SubmitButton>Save</SubmitButton>
                      </ActionForm>
                      {m.userId !== user.id && (
                        <form action={removeMember.bind(null, projectId, m.id)} className="mt-3 border-t border-line pt-3">
                          <button className={btnDanger}>Remove from project</button>
                        </form>
                      )}
                    </div>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className={`${card} p-5`} aria-labelledby="add-member">
          <h3 id="add-member" className="mb-4 font-semibold">Add member</h3>
          <ActionForm action={addMember.bind(null, projectId)} className="space-y-3" testId="add-member-form">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={label} htmlFor="add-email">Email</label>
                <input className={input} id="add-email" name="email" type="email" required />
              </div>
              <div>
                <label className={label} htmlFor="add-name">Name</label>
                <input className={input} id="add-name" name="name" />
              </div>
            </div>
            <MemberFields idPrefix="add" companies={companies} roles={roles} />
            <SubmitButton>Add member</SubmitButton>
          </ActionForm>
        </section>

        <section className={`${card} p-5`} aria-labelledby="bulk-invite">
          <h3 id="bulk-invite" className="font-semibold">Bulk invite (CSV)</h3>
          <p className="mb-4 mt-1 text-xs text-ink-soft">
            One person per line: <code>email,name,company,role,access</code>. Access is <code>member</code> or <code>admin</code>.
            New companies and roles are created for you; duplicate emails are flagged.
          </p>
          <ActionForm action={bulkInvite.bind(null, projectId)} className="space-y-3">
            <textarea
              className={`${input} h-36 font-mono`}
              name="csv"
              aria-label="CSV rows"
              placeholder={"email,name,company,role,access\nthandi@savanna.co.za,Thandi Mokoena,Savanna Builders,Site Manager,admin"}
              required
            />
            <fieldset>
              <legend className={label}>Services for everyone in this upload</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {(Object.keys(SERVICE_LABELS) as ServiceKey[]).map((s) => (
                  <label key={s} className="inline-flex items-center gap-2 text-sm">
                    <input type="checkbox" name="services" value={s} defaultChecked={s === "DOCS" || s === "ISSUES"} className="accent-brand" />
                    {SERVICE_LABELS[s]}
                  </label>
                ))}
              </div>
            </fieldset>
            <SubmitButton>Import</SubmitButton>
          </ActionForm>
        </section>
      </div>
    </div>
  );
}

import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { badge, card, input, label, td, th } from "@/components/ui";
import { db } from "@/lib/db";
import { requireProjectAdmin } from "@/lib/auth";
import { LEVELS, SERVICES, SERVICE_LABELS, effectiveLevel, type Grant, type ServiceKey } from "@/lib/permissions";
import { setServicePermission } from "@/modules/admin/actions";

const LEVEL_STYLE: Record<string, string> = {
  NONE: "bg-muted text-ink-soft",
  VIEWER: "bg-sky-100 text-sky-800",
  CREATOR: "bg-amber-100 text-amber-800",
  MANAGER: "bg-emerald-100 text-emerald-800",
};

export default async function ServicesPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { user } = await requireProjectAdmin(projectId);
  const [members, companies, roles, grants] = await Promise.all([
    db.projectMember.findMany({ where: { projectId }, include: { user: true, roles: true }, orderBy: { user: { name: "asc" } } }),
    db.company.findMany({ where: { accountId: user.accountId }, orderBy: { name: "asc" } }),
    db.role.findMany({ where: { accountId: user.accountId }, orderBy: { name: "asc" } }),
    db.servicePermission.findMany({ where: { projectId } }) as Promise<Grant[]>,
  ]);
  const subjectName = (g: Grant) =>
    g.subjectType === "USER"
      ? members.find((m) => m.userId === g.subjectId)?.user.name
      : g.subjectType === "ROLE"
        ? roles.find((r) => r.id === g.subjectId)?.name
        : companies.find((c) => c.id === g.subjectId)?.name;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Services &amp; permissions</h2>
        <p className="mt-1 text-sm text-ink-soft">
          Grant Viewer, Creator or Manager on each service to a person, a role or a whole company. A member gets the highest level that
          applies to them. Project admins are Managers everywhere.
        </p>
      </div>

      <section className={`${card} p-5`}>
        <h3 className="mb-4 font-semibold">Grant permission</h3>
        <ActionForm action={setServicePermission.bind(null, projectId)} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:items-end" testId="grant-form">
          <div>
            <label className={label} htmlFor="g-service">Service</label>
            <select className={input} id="g-service" name="service">
              {SERVICES.map((s) => <option key={s} value={s}>{SERVICE_LABELS[s]}</option>)}
            </select>
          </div>
          <div>
            <label className={label} htmlFor="g-subject">Grant to</label>
            <select className={input} id="g-subject" name="subject" required>
              <optgroup label="Companies">{companies.map((c) => <option key={c.id} value={`COMPANY:${c.id}`}>{c.name}</option>)}</optgroup>
              <optgroup label="Roles">{roles.map((r) => <option key={r.id} value={`ROLE:${r.id}`}>{r.name}</option>)}</optgroup>
              <optgroup label="People">{members.map((m) => <option key={m.userId} value={`USER:${m.userId}`}>{m.user.name}</option>)}</optgroup>
            </select>
          </div>
          <div>
            <label className={label} htmlFor="g-level">Level</label>
            <select className={input} id="g-level" name="level" defaultValue="VIEWER">
              {LEVELS.map((l) => <option key={l} value={l}>{l === "NONE" ? "Remove grant" : l[0] + l.slice(1).toLowerCase()}</option>)}
            </select>
          </div>
          <SubmitButton>Save</SubmitButton>
        </ActionForm>
      </section>

      <section>
        <h3 className="mb-3 font-semibold">Grants</h3>
        <div className={`${card} overflow-x-auto`}>
          <table className="w-full min-w-[480px]">
            <thead className="border-b border-line bg-muted/50"><tr><th className={th}>Service</th><th className={th}>Granted to</th><th className={th}>Level</th></tr></thead>
            <tbody className="divide-y divide-line">
              {grants.length === 0 && <tr><td className={`${td} text-ink-soft`} colSpan={3}>No grants yet. Members with a service enabled are Viewers.</td></tr>}
              {grants.map((g, i) => (
                <tr key={i}>
                  <td className={td}>{SERVICE_LABELS[g.service]}</td>
                  <td className={td}>{subjectName(g) ?? "(removed)"} <span className="text-xs text-ink-soft">· {g.subjectType.toLowerCase()}</span></td>
                  <td className={td}><span className={`${badge} ${LEVEL_STYLE[g.level]}`}>{g.level}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h3 className="mb-3 font-semibold">Effective access</h3>
        <div className={`${card} overflow-x-auto`}>
          <table className="w-full min-w-[640px]" data-testid="effective-table">
            <thead className="border-b border-line bg-muted/50">
              <tr><th className={th}>Member</th>{SERVICES.map((s) => <th key={s} className={th}>{SERVICE_LABELS[s]}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-line">
              {members.map((m) => {
                const ctx = { userId: m.userId, accessLevel: m.accessLevel, companyId: m.companyId, roleIds: m.roles.map((r) => r.roleId), services: m.services as ServiceKey[] };
                return (
                  <tr key={m.id}>
                    <td className={`${td} font-medium`}>{m.user.name}</td>
                    {SERVICES.map((s) => {
                      const l = effectiveLevel(ctx, s, grants);
                      return <td key={s} className={td}><span className={`${badge} ${LEVEL_STYLE[l]}`}>{l}</span></td>;
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

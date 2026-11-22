import { SERVICES, SERVICE_LABELS } from "@/lib/permissions";
import { input, label } from "./ui";

type Opt = { id: string; name: string };

/** Company / role / access level / services inputs shared by the add, edit and multi-project forms. */
export function MemberFields({
  companies,
  roles,
  idPrefix,
  defaults,
}: {
  companies: Opt[];
  roles: Opt[];
  idPrefix: string;
  defaults?: { companyId?: string | null; roleIds?: string[]; accessLevel?: string; services?: string[] };
}) {
  const services = defaults?.services ?? ["DOCS", "ISSUES"];
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor={`${idPrefix}-company`}>Company</label>
          <select className={input} id={`${idPrefix}-company`} name="companyId" defaultValue={defaults?.companyId ?? ""}>
            <option value="">— None —</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={label} htmlFor={`${idPrefix}-role`}>Role</label>
          <select className={input} id={`${idPrefix}-role`} name="roleIds" defaultValue={defaults?.roleIds?.[0] ?? ""}>
            <option value="">— None —</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className={label} htmlFor={`${idPrefix}-access`}>Access level</label>
        <select className={input} id={`${idPrefix}-access`} name="accessLevel" defaultValue={defaults?.accessLevel ?? "MEMBER"}>
          <option value="MEMBER">Project member</option>
          <option value="PROJECT_ADMIN">Project admin</option>
        </select>
      </div>
      <fieldset>
        <legend className={label}>Services</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {SERVICES.map((s) => (
            <label key={s} className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" name="services" value={s} defaultChecked={services.includes(s)} className="accent-brand" />
              {SERVICE_LABELS[s]}
            </label>
          ))}
        </div>
      </fieldset>
    </>
  );
}

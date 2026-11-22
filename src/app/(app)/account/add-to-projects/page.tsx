import { ActionForm } from "@/components/ActionForm";
import { MemberFields } from "@/components/MemberFields";
import { SubmitButton } from "@/components/SubmitButton";
import { card, input, label } from "@/components/ui";
import { db } from "@/lib/db";
import { requireAccountAdmin } from "@/lib/auth";
import { addUserToProjects } from "@/modules/admin/actions";

export default async function AddToProjectsPage() {
  const user = await requireAccountAdmin();
  const [projects, companies, roles] = await Promise.all([
    db.project.findMany({ where: { accountId: user.accountId, status: "ACTIVE" }, orderBy: { name: "asc" } }),
    db.company.findMany({ where: { accountId: user.accountId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.role.findMany({ where: { accountId: user.accountId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-semibold">Add a person to several projects</h1>
      <p className="mt-1 text-sm text-ink-soft">
        Pick the projects once instead of opening each one. If they are already on a project, their company, role, access and services there are updated.
      </p>
      <section className={`${card} mt-6 p-5`}>
        <ActionForm action={addUserToProjects} className="space-y-4" testId="multi-project-form">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor="mp-email">Email</label>
              <input className={input} id="mp-email" name="email" type="email" required />
            </div>
            <div>
              <label className={label} htmlFor="mp-name">Name</label>
              <input className={input} id="mp-name" name="name" />
            </div>
          </div>
          <fieldset>
            <legend className={label}>Projects</legend>
            {projects.length === 0 ? (
              <p className="text-sm text-ink-soft">No active projects.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {projects.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm hover:bg-muted">
                    <input type="checkbox" name="projectIds" value={p.id} className="accent-brand" />
                    <span className="truncate">{p.name}</span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>
          <MemberFields idPrefix="mp" companies={companies} roles={roles} />
          <SubmitButton>Add to selected projects</SubmitButton>
        </ActionForm>
      </section>
    </main>
  );
}

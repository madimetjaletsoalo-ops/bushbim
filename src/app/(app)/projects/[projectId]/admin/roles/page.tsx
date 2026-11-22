import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { card, input, label, td, th } from "@/components/ui";
import { db } from "@/lib/db";
import { requireProjectAdmin } from "@/lib/auth";
import { createRole } from "@/modules/admin/actions";

export default async function RolesPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { user } = await requireProjectAdmin(projectId);
  const roles = await db.role.findMany({
    where: { accountId: user.accountId },
    include: { _count: { select: { members: { where: { member: { projectId } } } } } },
    orderBy: { name: "asc" },
  });
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <section>
        <h2 className="mb-4 text-xl font-semibold">Roles</h2>
        <div className={`${card} overflow-x-auto`}>
          <table className="w-full min-w-[360px]">
            <thead className="border-b border-line bg-muted/50"><tr><th className={th}>Role</th><th className={th}>Members on this project</th></tr></thead>
            <tbody className="divide-y divide-line">
              {roles.length === 0 && <tr><td className={`${td} text-ink-soft`} colSpan={2}>No roles yet.</td></tr>}
              {roles.map((r) => (
                <tr key={r.id}><td className={`${td} font-medium`}>{r.name}</td><td className={td}>{r._count.members}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className={`${card} h-fit p-5`}>
        <h3 className="mb-4 font-semibold">Add role</h3>
        <ActionForm action={createRole.bind(null, projectId)} className="space-y-3">
          <div><label className={label} htmlFor="r-name">Name</label><input className={input} id="r-name" name="name" placeholder="e.g. Quantity Surveyor" required /></div>
          <SubmitButton>Add role</SubmitButton>
        </ActionForm>
      </section>
    </div>
  );
}

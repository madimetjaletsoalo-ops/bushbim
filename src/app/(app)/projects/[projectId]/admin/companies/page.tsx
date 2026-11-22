import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { card, input, label, td, th } from "@/components/ui";
import { db } from "@/lib/db";
import { requireProjectAdmin } from "@/lib/auth";
import { createCompany } from "@/modules/admin/actions";

export default async function CompaniesPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { user } = await requireProjectAdmin(projectId);
  const companies = await db.company.findMany({
    where: { accountId: user.accountId },
    include: { _count: { select: { members: { where: { projectId } } } } },
    orderBy: { name: "asc" },
  });
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <section>
        <h2 className="mb-4 text-xl font-semibold">Companies</h2>
        <div className={`${card} overflow-x-auto`}>
          <table className="w-full min-w-[480px]">
            <thead className="border-b border-line bg-muted/50">
              <tr><th className={th}>Company</th><th className={th}>Trade</th><th className={th}>Country</th><th className={th}>On this project</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {companies.length === 0 && <tr><td className={`${td} text-ink-soft`} colSpan={4}>No companies yet.</td></tr>}
              {companies.map((c) => (
                <tr key={c.id}>
                  <td className={`${td} font-medium`}>{c.name}</td>
                  <td className={td}>{c.trade ?? "—"}</td>
                  <td className={td}>{c.country ?? "—"}</td>
                  <td className={td}>{c._count.members}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-ink-soft">Companies are shared across all projects in your organisation.</p>
      </section>
      <section className={`${card} h-fit p-5`}>
        <h3 className="mb-4 font-semibold">Add company</h3>
        <ActionForm action={createCompany.bind(null, projectId)} className="space-y-3">
          <div><label className={label} htmlFor="c-name">Name</label><input className={input} id="c-name" name="name" required /></div>
          <div><label className={label} htmlFor="c-trade">Trade</label><input className={input} id="c-trade" name="trade" placeholder="e.g. Thatching, MEP, Joinery" /></div>
          <div><label className={label} htmlFor="c-country">Country</label><input className={input} id="c-country" name="country" /></div>
          <SubmitButton>Add company</SubmitButton>
        </ActionForm>
      </section>
    </div>
  );
}

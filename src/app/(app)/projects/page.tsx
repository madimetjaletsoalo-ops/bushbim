import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { card, input, label } from "@/components/ui";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { createProject } from "@/modules/admin/actions";

export default async function ProjectsPage() {
  const user = await requireUser();
  const isAdmin = user.accountRole === "ACCOUNT_ADMIN";
  const projects = await db.project.findMany({
    where: isAdmin ? { accountId: user.accountId } : { accountId: user.accountId, members: { some: { userId: user.id } } },
    include: { _count: { select: { members: true } } },
    orderBy: { createdAt: "desc" },
  });
  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-semibold">Projects</h1>
      <p className="mt-1 text-sm text-ink-soft">{user.account.name}</p>
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
        <section aria-label="Project list" className="space-y-3">
          {projects.length === 0 && (
            <div className={`${card} p-8 text-center text-sm text-ink-soft`}>
              {isAdmin ? "No projects yet. Create your first one." : "You haven't been added to any projects yet."}
            </div>
          )}
          {projects.map((p) => (
            <Link key={p.id} href={`/projects/${p.id}`} className={`${card} block p-5 transition hover:border-brand`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-lg font-semibold">{p.name}</h2>
                {p.code && <span className="font-mono text-xs text-ink-soft">{p.code}</span>}
              </div>
              <p className="mt-1 text-sm text-ink-soft">
                {[p.type, p.location, p.country].filter(Boolean).join(" · ") || "No details yet"}
              </p>
              <p className="mt-3 text-xs text-ink-soft">
                {p._count.members} member{p._count.members === 1 ? "" : "s"} · {p.currency} · {p.timezone}
              </p>
            </Link>
          ))}
        </section>
        {isAdmin && (
          <section aria-label="Create project" className={`${card} h-fit p-5`}>
            <h2 className="mb-4 font-semibold">New project</h2>
            <ActionForm action={createProject} className="space-y-3">
              <div>
                <label className={label} htmlFor="name">Name</label>
                <input className={input} id="name" name="name" placeholder="Okavango Tented Camp" required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={label} htmlFor="code">Code</label>
                  <input className={input} id="code" name="code" placeholder="OTC-01" />
                </div>
                <div>
                  <label className={label} htmlFor="type">Type</label>
                  <input className={input} id="type" name="type" placeholder="Safari lodge" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={label} htmlFor="location">Location</label>
                  <input className={input} id="location" name="location" placeholder="Maun" />
                </div>
                <div>
                  <label className={label} htmlFor="country">Country</label>
                  <input className={input} id="country" name="country" placeholder="Botswana" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={label} htmlFor="currency">Currency</label>
                  <select className={input} id="currency" name="currency" defaultValue="ZAR">
                    {["ZAR", "USD", "EUR", "BWP", "KES", "TZS", "NAD", "MUR", "RWF", "ZMW", "NGN", "MAD"].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={label} htmlFor="timezone">Timezone</label>
                  <select className={input} id="timezone" name="timezone" defaultValue="Africa/Johannesburg">
                    {["Africa/Johannesburg", "Africa/Gaborone", "Africa/Windhoek", "Africa/Nairobi", "Africa/Dar_es_Salaam", "Africa/Kigali", "Africa/Lusaka", "Africa/Lagos", "Africa/Casablanca", "Indian/Mauritius", "Indian/Mahe"].map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={label} htmlFor="startDate">Start</label>
                  <input className={input} id="startDate" name="startDate" type="date" />
                </div>
                <div>
                  <label className={label} htmlFor="endDate">Handover</label>
                  <input className={input} id="endDate" name="endDate" type="date" />
                </div>
              </div>
              <SubmitButton>Create project</SubmitButton>
            </ActionForm>
          </section>
        )}
      </div>
    </main>
  );
}

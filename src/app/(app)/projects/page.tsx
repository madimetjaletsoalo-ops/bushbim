import Image from "next/image";
import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { btn, card, input, label } from "@/components/ui";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { projectInitials } from "@/lib/projects";
import { createProject } from "@/modules/admin/actions";

const CURRENCIES = ["ZAR", "USD", "EUR", "BWP", "KES", "TZS", "NAD", "MUR", "RWF", "ZMW", "NGN", "MAD"];
const TIMEZONES = ["Africa/Johannesburg", "Africa/Gaborone", "Africa/Windhoek", "Africa/Nairobi", "Africa/Dar_es_Salaam", "Africa/Kigali", "Africa/Lusaka", "Africa/Lagos", "Africa/Casablanca", "Indian/Mauritius", "Indian/Mahe"];

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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Projects</h1>
          <p className="mt-1 text-sm text-ink-soft">{user.account.name}</p>
        </div>
      </div>

      {isAdmin && (
        <details className="group mt-6" open={projects.length === 0} data-testid="new-project">
          <summary className={`${btn} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
            <span aria-hidden className="text-base leading-none transition-transform group-open:rotate-45">+</span> New project
          </summary>
          <section aria-label="Create project" className={`${card} mt-3 p-5`}>
            <ActionForm action={createProject}>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div className="sm:col-span-2 lg:col-span-1">
                  <label className={label} htmlFor="name">Name</label>
                  <input className={input} id="name" name="name" placeholder="Okavango Tented Camp" required />
                </div>
                <div>
                  <label className={label} htmlFor="code">Code</label>
                  <input className={input} id="code" name="code" placeholder="OTC-01" />
                </div>
                <div>
                  <label className={label} htmlFor="type">Type</label>
                  <input className={input} id="type" name="type" placeholder="Safari lodge" />
                </div>
                <div>
                  <label className={label} htmlFor="location">Location</label>
                  <input className={input} id="location" name="location" placeholder="Maun" />
                </div>
                <div>
                  <label className={label} htmlFor="country">Country</label>
                  <input className={input} id="country" name="country" placeholder="Botswana" />
                </div>
                <div>
                  <label className={label} htmlFor="currency">Currency</label>
                  <select className={input} id="currency" name="currency" defaultValue="ZAR">
                    {CURRENCIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={label} htmlFor="timezone">Timezone</label>
                  <select className={input} id="timezone" name="timezone" defaultValue="Africa/Johannesburg">
                    {TIMEZONES.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={label} htmlFor="startDate">Start</label>
                  <input className={input} id="startDate" name="startDate" type="date" />
                </div>
                <div>
                  <label className={label} htmlFor="endDate">Handover</label>
                  <input className={input} id="endDate" name="endDate" type="date" />
                </div>
              </div>
              <div className="pt-2">
                <SubmitButton>Create project</SubmitButton>
              </div>
            </ActionForm>
          </section>
        </details>
      )}

      <section aria-label="Project list" className="mt-6">
        {projects.length === 0 ? (
          <div className={`${card} p-8 text-center text-sm text-ink-soft`}>
            {isAdmin ? "No projects yet. Create your first one." : "You haven't been added to any projects yet."}
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <li key={p.id}>
                <Link href={`/projects/${p.id}`} className={`${card} group block h-full overflow-hidden transition hover:border-brand`}>
                  <div className="relative aspect-video bg-muted" data-testid="project-cover">
                    {p.coverImage ? (
                      <Image
                        src={p.coverImage}
                        alt={`${p.name} project`}
                        fill
                        sizes="(min-width: 1024px) 352px, (min-width: 640px) 50vw, 100vw"
                        className="object-cover transition duration-300 group-hover:scale-[1.02]"
                      />
                    ) : (
                      <div aria-hidden className="flex h-full items-center justify-center bg-gradient-to-br from-brand to-chrome text-3xl font-semibold tracking-wide text-white/90">
                        {projectInitials(p.name, p.code)}
                      </div>
                    )}
                  </div>
                  <div className="p-4">
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
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

import Link from "next/link";
import { Logo } from "@/components/Logo";
import { ProjectSwitcher } from "@/components/ProjectSwitcher";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { signOut } from "@/modules/admin/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const projects = await db.project.findMany({
    where:
      user.accountRole === "ACCOUNT_ADMIN"
        ? { accountId: user.accountId }
        : { accountId: user.accountId, members: { some: { userId: user.id } } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return (
    <div className="min-h-screen">
      <header className="bg-chrome text-chrome-ink">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          <Link href="/projects" className="text-lg text-white">
            <Logo />
          </Link>
          <span className="hidden h-5 w-px bg-white/20 sm:block" />
          <span className="hidden text-sm text-chrome-ink/80 sm:inline">{user.account.name}</span>
          <ProjectSwitcher projects={projects} />
          <div className="ml-auto flex items-center gap-3 text-sm">
            {user.accountRole === "ACCOUNT_ADMIN" && (
              <Link href="/account/add-to-projects" className="hidden text-chrome-ink/80 hover:text-white md:inline">
                Add people to projects
              </Link>
            )}
            <span className="hidden text-chrome-ink/80 sm:inline" title={user.email}>{user.name}</span>
            <form action={signOut}>
              <button className="rounded-md border border-white/15 px-2 py-1 text-xs hover:bg-white/10">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}

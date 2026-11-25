import { notFound } from "next/navigation";
import { NavLink } from "@/components/NavLink";
import { getProjectContext } from "@/lib/auth";
import { can } from "@/lib/permissions";

export default async function IssuesLayout({ children, params }: { children: React.ReactNode; params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { member, grants } = await getProjectContext(projectId);
  if (!can(member, "ISSUES", "view", grants)) notFound();
  const base = `/projects/${projectId}/issues`;
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 md:flex-row md:gap-6 md:py-6">
      <nav aria-label="Issues" className="flex gap-1 overflow-x-auto md:w-44 md:shrink-0 md:flex-col md:overflow-visible">
        <NavLink variant="side" href={base} exact>All issues</NavLink>
        {can(member, "ISSUES", "create", grants) && <NavLink variant="side" href={`${base}/new`}>New issue</NavLink>}
        {can(member, "ISSUES", "manage", grants) && <NavLink variant="side" href={`${base}/settings`}>Settings</NavLink>}
      </nav>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

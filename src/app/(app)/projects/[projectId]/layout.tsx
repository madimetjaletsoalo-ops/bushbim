import { NavLink } from "@/components/NavLink";
import { getProjectContext } from "@/lib/auth";
import { can } from "@/lib/permissions";

export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { project, member, grants, isAdmin } = await getProjectContext(projectId);
  const base = `/projects/${projectId}`;

  return (
    <>
      <div className="bg-chrome text-chrome-ink">
        <div className="flex flex-wrap items-end gap-x-6 px-4 sm:px-6">
          <h1 className="py-3 text-xl font-medium text-white">{project.name}</h1>
          <nav aria-label="Modules" className="-mb-px flex overflow-x-auto">
            {can(member, "DOCS", "view", grants) && <NavLink href={`${base}/docs`}>Document Control</NavLink>}
            {can(member, "DOCS", "view", grants) && <NavLink href={`${base}/reviews`}>Reviews</NavLink>}
            {can(member, "DOCS", "view", grants) && <NavLink href={`${base}/transmittals`}>Transmittals</NavLink>}
            {can(member, "ISSUES", "view", grants) && <NavLink href={`${base}/issues`}>Issues</NavLink>}
            {can(member, "CHECKLISTS", "view", grants) && <NavLink href={`${base}/checklists`}>Checklists</NavLink>}
            {can(member, "DAILY_LOGS", "view", grants) && <NavLink href={`${base}/field`}>Daily Logs</NavLink>}
            {isAdmin && <NavLink href={`${base}/admin`}>Project Admin</NavLink>}
          </nav>
        </div>
      </div>
      {children}
    </>
  );
}

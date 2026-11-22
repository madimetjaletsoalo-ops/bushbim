import { NavLink } from "@/components/NavLink";
import { getProjectContext } from "@/lib/auth";
import { can } from "@/lib/permissions";

export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { project, member, grants, isAdmin } = await getProjectContext(projectId);
  const base = `/projects/${projectId}`;
  const showField = (["ISSUES", "CHECKLISTS", "DAILY_LOGS"] as const).some((s) => can(member, s, "view", grants));
  return (
    <>
      <div className="bg-chrome text-chrome-ink">
        <div className="flex flex-wrap items-end gap-x-6 px-4 sm:px-6">
          <h1 className="py-3 text-xl font-medium text-white">{project.name}</h1>
          <nav aria-label="Modules" className="-mb-px flex overflow-x-auto">
            {can(member, "DOCS", "view", grants) && <NavLink href={`${base}/docs`}>Document Control</NavLink>}
            {showField && <NavLink href={`${base}/field`}>Field Management</NavLink>}
            {isAdmin && <NavLink href={`${base}/admin`}>Project Admin</NavLink>}
          </nav>
        </div>
      </div>
      {children}
    </>
  );
}

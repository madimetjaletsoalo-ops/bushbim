import { NavLink } from "@/components/NavLink";
import { OfflineBar } from "@/components/offline/OfflineBar";
import { getProjectContext } from "@/lib/auth";
import { can } from "@/lib/permissions";

export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { project, member, grants, isAdmin, user } = await getProjectContext(projectId);
  const base = `/projects/${projectId}`;
  // pages kept for offline use even before they are opened
  const warm = [
    `${base}/offline`,
    ...(can(member, "ISSUES", "view", grants) ? [`${base}/issues`] : []),
    ...(can(member, "ISSUES", "create", grants) ? [`${base}/issues/new`] : []),
    ...(can(member, "CHECKLISTS", "view", grants) ? [`${base}/checklists`] : []),
  ];

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
            {can(member, "DAILY_LOGS", "view", grants) && <NavLink href={`${base}/daily-logs`}>Daily Logs</NavLink>}
            {(can(member, "DOCS", "view", grants) || can(member, "ISSUES", "view", grants)) && <NavLink href={`${base}/search`}>Search</NavLink>}
            {isAdmin && <NavLink href={`${base}/admin`}>Project Admin</NavLink>}
          </nav>
        </div>
      </div>
      <OfflineBar projectId={projectId} userId={user.id} warm={warm} />
      {children}
    </>
  );
}

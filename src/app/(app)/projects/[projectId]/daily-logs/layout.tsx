import { notFound } from "next/navigation";
import { NavLink } from "@/components/NavLink";
import { getProjectContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { todayIn } from "@/modules/issues/logic";

export default async function DailyLogsLayout({ children, params }: { children: React.ReactNode; params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { member, grants, project } = await getProjectContext(projectId);
  if (!can(member, "DAILY_LOGS", "view", grants)) notFound();
  const base = `/projects/${projectId}/daily-logs`;
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 md:flex-row md:gap-6 md:py-6">
      <nav aria-label="Daily Logs" className="flex gap-1 overflow-x-auto md:w-44 md:shrink-0 md:flex-col md:overflow-visible">
        <NavLink variant="side" href={base} exact>All logs</NavLink>
        <NavLink variant="side" href={`${base}/${todayIn(project.timezone)}`}>Today</NavLink>
        {can(member, "DAILY_LOGS", "manage", grants) && <NavLink variant="side" href={`${base}/settings`}>Settings</NavLink>}
      </nav>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

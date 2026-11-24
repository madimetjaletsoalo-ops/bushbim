import { notFound } from "next/navigation";
import { NavLink } from "@/components/NavLink";
import { getProjectContext } from "@/lib/auth";
import { can } from "@/lib/permissions";

export default async function ChecklistsLayout({ children, params }: { children: React.ReactNode; params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { member, grants } = await getProjectContext(projectId);
  if (!can(member, "CHECKLISTS", "view", grants)) notFound();
  const base = `/projects/${projectId}/checklists`;
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 md:flex-row md:gap-6 md:py-6">
      <nav aria-label="Checklists" className="flex gap-1 overflow-x-auto md:w-44 md:shrink-0 md:flex-col md:overflow-visible">
        <NavLink variant="side" href={base} exact>All checklists</NavLink>
        {can(member, "CHECKLISTS", "create", grants) && <NavLink variant="side" href={`${base}/new`}>New checklist</NavLink>}
        {can(member, "CHECKLISTS", "manage", grants) && <NavLink variant="side" href={`${base}/templates`}>Templates</NavLink>}
      </nav>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

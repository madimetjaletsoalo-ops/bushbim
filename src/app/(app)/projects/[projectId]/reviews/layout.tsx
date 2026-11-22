import { notFound } from "next/navigation";
import { NavLink } from "@/components/NavLink";
import { getProjectContext } from "@/lib/auth";
import { can } from "@/lib/permissions";

export default async function ReviewsLayout({ children, params }: { children: React.ReactNode; params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { member, grants, isAdmin } = await getProjectContext(projectId);
  if (!can(member, "DOCS", "view", grants)) notFound();
  const base = `/projects/${projectId}/reviews`;
  const manage = isAdmin || can(member, "DOCS", "manage", grants);
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 md:flex-row md:gap-6 md:py-6">
      <nav aria-label="Reviews" className="flex gap-1 overflow-x-auto md:w-48 md:shrink-0 md:flex-col md:overflow-visible">
        <NavLink variant="side" href={base} exact>All reviews</NavLink>
        <NavLink variant="side" href={`${base}/new`}>Start a review</NavLink>
        {manage && <NavLink variant="side" href={`${base}/workflows`}>Workflows</NavLink>}
      </nav>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

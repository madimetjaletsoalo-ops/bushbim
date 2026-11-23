import { notFound } from "next/navigation";
import { NavLink } from "@/components/NavLink";
import { getProjectContext } from "@/lib/auth";
import { can } from "@/lib/permissions";

export default async function TransmittalsLayout({ children, params }: { children: React.ReactNode; params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { member, grants } = await getProjectContext(projectId);
  if (!can(member, "DOCS", "view", grants)) notFound();
  const base = `/projects/${projectId}/transmittals`;
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 md:flex-row md:gap-6 md:py-6">
      <nav aria-label="Transmittals" className="flex gap-1 overflow-x-auto md:w-48 md:shrink-0 md:flex-col md:overflow-visible">
        <NavLink variant="side" href={base} exact>Transmittal log</NavLink>
        {can(member, "DOCS", "create", grants) && <NavLink variant="side" href={`${base}/new`}>New transmittal</NavLink>}
      </nav>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

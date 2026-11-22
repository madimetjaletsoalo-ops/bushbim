import { NavLink } from "@/components/NavLink";
import { requireProjectAdmin } from "@/lib/auth";

export default async function AdminLayout({ children, params }: { children: React.ReactNode; params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  await requireProjectAdmin(projectId);
  const base = `/projects/${projectId}/admin`;
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 md:flex-row">
      <nav aria-label="Project admin" className="flex gap-1 overflow-x-auto md:w-48 md:flex-col md:overflow-visible">
        <NavLink variant="side" href={`${base}/members`}>Members</NavLink>
        <NavLink variant="side" href={`${base}/companies`}>Companies</NavLink>
        <NavLink variant="side" href={`${base}/roles`}>Roles</NavLink>
        <NavLink variant="side" href={`${base}/services`}>Services</NavLink>
        <NavLink variant="side" href={`${base}/activity`}>Activity</NavLink>
      </nav>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

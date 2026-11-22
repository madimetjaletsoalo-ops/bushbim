import { redirect } from "next/navigation";
import { getProjectContext } from "@/lib/auth";
import { can } from "@/lib/permissions";

export default async function ProjectHome({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { member, grants, isAdmin } = await getProjectContext(projectId);
  if (can(member, "DOCS", "view", grants)) redirect(`/projects/${projectId}/docs`);
  if (isAdmin) redirect(`/projects/${projectId}/admin/members`);
  redirect(`/projects/${projectId}/field`);
}

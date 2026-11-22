import { redirect } from "next/navigation";

export default async function AdminHome({ params }: { params: Promise<{ projectId: string }> }) {
  redirect(`/projects/${(await params).projectId}/admin/members`);
}

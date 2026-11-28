import { redirect } from "next/navigation";

/** Old link: Daily Logs moved to /daily-logs. */
export default async function FieldPage({ params }: { params: Promise<{ projectId: string }> }) {
  redirect(`/projects/${(await params).projectId}/daily-logs`);
}

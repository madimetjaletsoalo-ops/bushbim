import { redirect } from "next/navigation";
import { parseDay } from "@/modules/daily-logs/logic";

/** "Open a day" form target: sends the browser to that day's log page. */
export default async function GoToDay({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ day?: string }> }) {
  const { projectId } = await params;
  const day = parseDay((await searchParams).day);
  redirect(`/projects/${projectId}/daily-logs${day ? `/${day}` : ""}`);
}

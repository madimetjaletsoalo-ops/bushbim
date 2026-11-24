import { ComingSoon } from "@/components/ComingSoon";
import { getProjectContext } from "@/lib/auth";

export default async function FieldPage({ params }: { params: Promise<{ projectId: string }> }) {
  await getProjectContext((await params).projectId);
  return (
    <ComingSoon
      title="Daily Logs"
      items={["Daily Logs with weather, labour per company and subcontractor input"]}
    />
  );
}

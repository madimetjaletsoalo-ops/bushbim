import { ComingSoon } from "@/components/ComingSoon";
import { getProjectContext } from "@/lib/auth";

export default async function FieldPage({ params }: { params: Promise<{ projectId: string }> }) {
  await getProjectContext((await params).projectId);
  return (
    <ComingSoon
      title="Field Management"
      items={[
        "Checklists from templates (quality, safety, snagging, commissioning)",
        "Daily Logs with weather, labour per company and subcontractor input",
      ]}
    />
  );
}

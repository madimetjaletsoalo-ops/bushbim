import { ComingSoon } from "@/components/ComingSoon";
import { getProjectContext } from "@/lib/auth";

export default async function DocsPage({ params }: { params: Promise<{ projectId: string }> }) {
  await getProjectContext((await params).projectId);
  return (
    <ComingSoon
      title="Document Control"
      items={[
        "Folder tree (Plans and Project Files) with upload and version history",
        "Folder permissions by user, role or company",
        "PDF viewer with markups, sheet splitting and Sets",
        "Reviews with approval workflows, and Transmittals",
      ]}
    />
  );
}

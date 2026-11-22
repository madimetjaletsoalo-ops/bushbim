import { redirect } from "next/navigation";
import { card } from "@/components/ui";
import { db } from "@/lib/db";
import { getDocsContext } from "@/modules/docs/access";
import { ensureRootFolders } from "@/modules/docs/roots";

/** Document Control opens on Plans, or else on the first folder shared with the member. */
export default async function DocsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  await ensureRootFolders(db, projectId);
  const { folders, visible } = await getDocsContext(projectId);
  const { openable } = visible();
  const plans = folders.find((f) => f.root === "PLANS");
  const files = folders.find((f) => f.root === "PROJECT_FILES");
  const target =
    [plans, files].find((f) => f && openable.has(f.id)) ??
    folders.filter((f) => openable.has(f.id)).sort((a, b) => a.name.localeCompare(b.name))[0];
  if (target) redirect(`/projects/${projectId}/docs/folders/${target.id}`);
  return (
    <div className={`${card} p-8 text-center text-sm text-ink-soft`}>
      No folders have been shared with you on this project yet. Ask a project admin for access.
    </div>
  );
}

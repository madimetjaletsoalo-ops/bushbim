import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getProjectContext } from "@/lib/auth";
import { ensureRootFolders } from "@/modules/docs/roots";

/** Document Control opens on the Plans folder. */
export default async function DocsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  await getProjectContext(projectId);
  await ensureRootFolders(db, projectId);
  const plans = await db.folder.findFirst({ where: { projectId, root: "PLANS" } });
  if (!plans) notFound();
  redirect(`/projects/${projectId}/docs/folders/${plans.id}`);
}

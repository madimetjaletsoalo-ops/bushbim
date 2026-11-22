import { notFound } from "next/navigation";
import { FolderTree } from "@/components/docs/FolderTree";
import { db } from "@/lib/db";
import { getProjectContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { buildTree, type RootKey } from "@/modules/docs/logic";
import { ensureRootFolders } from "@/modules/docs/roots";

export default async function DocsLayout({ children, params }: { children: React.ReactNode; params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { member, grants } = await getProjectContext(projectId);
  if (!can(member, "DOCS", "view", grants)) notFound();
  await ensureRootFolders(db, projectId);
  const folders = await db.folder.findMany({ where: { projectId }, select: { id: true, parentId: true, name: true, root: true } });
  const tree = buildTree(folders.map((f) => ({ ...f, root: f.root as RootKey | null })));
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 md:flex-row md:gap-6 md:py-6">
      <aside className="md:w-60 md:shrink-0">
        <FolderTree projectId={projectId} tree={tree} />
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

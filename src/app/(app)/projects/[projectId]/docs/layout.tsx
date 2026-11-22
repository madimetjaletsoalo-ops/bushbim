import { notFound } from "next/navigation";
import { FolderTree } from "@/components/docs/FolderTree";
import { db } from "@/lib/db";
import { getProjectContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getDocsContext } from "@/modules/docs/access";
import { buildTree, type RootKey } from "@/modules/docs/logic";
import { ensureRootFolders } from "@/modules/docs/roots";

export default async function DocsLayout({ children, params }: { children: React.ReactNode; params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { member, grants } = await getProjectContext(projectId);
  if (!can(member, "DOCS", "view", grants)) notFound();
  await ensureRootFolders(db, projectId);
  const { folders, visible } = await getDocsContext(projectId);
  // only folders the member can open, plus the path down to them
  const { visible: shown, openable } = visible();
  const tree = buildTree(
    folders.filter((f) => shown.has(f.id)).map((f) => ({ ...f, root: f.root as RootKey | null, locked: !openable.has(f.id) })),
  );
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 md:flex-row md:gap-6 md:py-6">
      <aside className="md:w-60 md:shrink-0">
        <FolderTree projectId={projectId} tree={tree} />
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

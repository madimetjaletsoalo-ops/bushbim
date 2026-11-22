import "server-only";
import { cache } from "react";
import { db } from "@/lib/db";
import { getProjectContext } from "@/lib/auth";
import { buildIndex, folderLevel, levelAtLeast, visibleFolders, type FolderGrant, type FolderLevel } from "./folder-permissions";

/** Project context plus every folder and folder grant, loaded once per request. */
export const getDocsContext = cache(async (projectId: string) => {
  const ctx = await getProjectContext(projectId);
  const [folders, grants] = await Promise.all([
    db.folder.findMany({ where: { projectId }, select: { id: true, parentId: true, name: true, root: true } }),
    db.folderPermission.findMany({ where: { folder: { projectId } } }),
  ]);
  const index = buildIndex(folders, grants as FolderGrant[]);
  const levelOn = (folderId: string) => folderLevel(ctx.member, ctx.grants, index, folderId);
  return { ...ctx, folders, index, levelOn, visible: () => visibleFolders(ctx.member, ctx.grants, index) };
});

/**
 * Re-checks access for a docs action on one folder. Returns the context and the
 * member's level there, or null if the folder isn't in this project or the level is too low.
 */
export async function folderAccess(projectId: string, folderId: string, min: FolderLevel) {
  if (typeof folderId !== "string" || !folderId || folderId.length > 64) return null;
  const ctx = await getDocsContext(projectId);
  const folder = ctx.folders.find((f) => f.id === folderId);
  if (!folder) return null;
  const level = ctx.levelOn(folderId);
  if (!levelAtLeast(level, min)) return null;
  return { ...ctx, folder, level };
}

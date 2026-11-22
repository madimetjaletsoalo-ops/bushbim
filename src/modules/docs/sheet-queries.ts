import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getDocsContext } from "./access";
import { levelAtLeast } from "./folder-permissions";
import { sortSheets } from "./sheets";

export interface SheetRow {
  id: string;
  number: string;
  title: string;
  page: number;
  versionId: string;
  versionNumber: number;
  isCurrent: boolean;
  docName: string;
  updatedAt: Date;
  sets: { id: string; name: string }[];
  canEdit: boolean;
  viewHref: string;
  /** the same sheet in the previous version, if there is one */
  compareHref: string | null;
}

/** Sheets the current member may see, sorted by number. `currentOnly` keeps each document's latest version. */
export async function loadSheets(projectId: string, where: Prisma.SheetWhereInput, currentOnly: boolean): Promise<SheetRow[]> {
  const ctx = await getDocsContext(projectId);
  const sheets = await db.sheet.findMany({
    where: { projectId, ...where },
    include: {
      sets: { include: { set: { select: { id: true, name: true } } } },
      version: {
        select: {
          id: true,
          number: true,
          document: {
            select: { name: true, folderId: true, currentVersion: true, versions: { select: { id: true, number: true, sheets: { select: { page: true, number: true } } } } },
          },
        },
      },
    },
  });
  const rows: SheetRow[] = [];
  for (const s of sheets) {
    const doc = s.version.document;
    const level = ctx.levelOn(doc.folderId);
    if (!levelAtLeast(level, "VIEW")) continue;
    const isCurrent = s.version.number === doc.currentVersion;
    if (currentOnly && !isCurrent) continue;
    const prev = doc.versions.find((v) => v.number === s.version.number - 1);
    // match the previous version's sheet by number, else by page
    const prevPage = prev ? (prev.sheets.find((x) => x.number === s.number)?.page ?? (prev.sheets.some((x) => x.page === s.page) ? s.page : null)) : null;
    rows.push({
      id: s.id,
      number: s.number,
      title: s.title,
      page: s.page,
      versionId: s.version.id,
      versionNumber: s.version.number,
      isCurrent,
      docName: doc.name,
      updatedAt: s.updatedAt,
      sets: s.sets.map((x) => x.set),
      canEdit: levelAtLeast(level, "UPLOAD"),
      viewHref: `/projects/${projectId}/viewer/${s.version.id}?page=${s.page}`,
      compareHref: prev && prevPage ? `/projects/${projectId}/compare?a=${prev.id}&pa=${prevPage}&b=${s.version.id}&pb=${s.page}` : null,
    });
  }
  return sortSheets(rows);
}

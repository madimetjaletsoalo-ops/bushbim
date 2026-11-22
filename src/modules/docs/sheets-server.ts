import "server-only";
import { db } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { isImage, isViewable } from "./markup";
import { readPdfText } from "./sheet-extract";
import { DEFAULT_REGIONS, isUnderPlans, regionSchema, sheetLabels, textInRegion, type Region, type TextItem } from "./sheets";

/** Files larger than this get sheets named after the file instead of reading their title blocks. */
const MAX_PARSE_BYTES = 100 * 1024 * 1024;

export async function titleBlockRegions(projectId: string): Promise<{ number: Region; title: Region }> {
  const s = await db.titleBlockSettings.findUnique({ where: { projectId } });
  const n = regionSchema.safeParse(s?.numberRegion);
  const t = regionSchema.safeParse(s?.titleRegion);
  return { number: n.success ? n.data : DEFAULT_REGIONS.number, title: t.success ? t.data : DEFAULT_REGIONS.title };
}

type VersionRow = { id: string; storageKey: string; fileName: string; contentType: string; size: number };

/** Page count and per-page text for a stored version; text is empty when it can't or shouldn't be read. */
async function pagesOf(v: VersionRow): Promise<{ pageCount: number; pages: TextItem[][] }> {
  if (isImage(v.contentType, v.fileName)) return { pageCount: 1, pages: [[]] };
  try {
    const bytes = await getStorage().read(v.storageKey);
    if (v.size > MAX_PARSE_BYTES) {
      // still count pages, cheaply, without reading text
      const { PDFDocument } = await import("pdf-lib");
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
      return { pageCount: doc.getPageCount(), pages: [] };
    }
    return await readPdfText(bytes);
  } catch (e) {
    console.error("sheets: couldn't read", v.fileName, e);
    return { pageCount: 1, pages: [] };
  }
}

/**
 * Creates (or, with `reread`, refreshes) the sheets of a version uploaded under Plans.
 * Sheets someone has edited by hand are left alone. Returns how many sheets the version has.
 */
export async function syncSheetsForVersion(projectId: string, versionId: string, opts: { reread?: boolean; regions?: { number: Region; title: Region } } = {}) {
  const v = await db.documentVersion.findFirst({
    where: { id: versionId, document: { projectId } },
    include: { document: { select: { folderId: true } }, sheets: true },
  });
  if (!v || !isViewable(v.contentType, v.fileName)) return 0;
  const folders = await db.folder.findMany({ where: { projectId }, select: { id: true, parentId: true, root: true } });
  if (!isUnderPlans(folders, v.document.folderId)) return 0;
  if (v.sheets.length && !opts.reread) return v.sheets.length;

  const regions = opts.regions ?? (await titleBlockRegions(projectId));
  const { pageCount, pages } = await pagesOf(v);
  for (let n = 1; n <= pageCount; n++) {
    const items = pages[n - 1] ?? [];
    const labels = sheetLabels(textInRegion(items, regions.number), textInRegion(items, regions.title), n, pageCount, v.fileName);
    const existing = v.sheets.find((s) => s.page === n);
    if (!existing) await db.sheet.create({ data: { projectId, versionId: v.id, page: n, ...labels } });
    else if (!existing.edited) await db.sheet.update({ where: { id: existing.id }, data: labels });
  }
  return pageCount;
}

/** Re-reads every version under Plans: creates missing sheets and refreshes unedited ones. */
export async function rebuildProjectSheets(projectId: string) {
  const regions = await titleBlockRegions(projectId);
  const versions = await db.documentVersion.findMany({ where: { document: { projectId } }, select: { id: true } });
  let sheets = 0;
  for (const v of versions) sheets += await syncSheetsForVersion(projectId, v.id, { reread: true, regions });
  return sheets;
}

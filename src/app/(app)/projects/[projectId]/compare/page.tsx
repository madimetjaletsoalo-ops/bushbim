import { notFound } from "next/navigation";
import { Compare } from "@/components/docs/Compare";
import { db } from "@/lib/db";
import { getDocsContext } from "@/modules/docs/access";
import { levelAtLeast } from "@/modules/docs/folder-permissions";
import { isImage, isViewable } from "@/modules/docs/markup";

type Search = { a?: string; b?: string; pa?: string; pb?: string };

/** Two versions (or two sheets) side by side and as an overlay. Needs View on both. */
export default async function ComparePage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<Search> }) {
  const { projectId } = await params;
  const sp = await searchParams;
  const ctx = await getDocsContext(projectId);
  if (!sp.a || !sp.b) notFound();
  const versions = await db.documentVersion.findMany({
    where: { id: { in: [sp.a, sp.b] }, document: { projectId } },
    include: { document: { select: { name: true, folderId: true } }, sheets: { select: { page: true, number: true, title: true } } },
  });
  const va = versions.find((v) => v.id === sp.a);
  const vb = versions.find((v) => v.id === sp.b);
  if (!va || !vb) notFound();
  for (const v of [va, vb]) if (!levelAtLeast(ctx.levelOn(v.document.folderId), "VIEW") || !isViewable(v.contentType, v.fileName)) notFound();
  const page = (raw: string | undefined) => Math.max(1, Math.min(10_000, parseInt(raw ?? "1", 10) || 1));
  const side = (v: typeof va, p: number) => {
    const sheet = v.sheets.find((s) => s.page === p);
    return {
      label: `V${v.number}`,
      src: `/api/projects/${projectId}/versions/${v.id}/view`,
      page: p,
      kind: isImage(v.contentType, v.fileName) ? ("image" as const) : ("pdf" as const),
      title: sheet ? `${sheet.number} ${sheet.title}` : `${v.document.name}${p > 1 ? `, page ${p}` : ""}`,
    };
  };
  const a = side(va, page(sp.pa));
  const b = side(vb, page(sp.pb));
  return (
    <Compare
      a={a}
      b={b}
      title={vb.document.name}
      backHref={`/projects/${projectId}/viewer/${vb.id}?page=${b.page}`}
    />
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { ConfirmButton } from "@/components/docs/ConfirmButton";
import { FolderGlyph } from "@/components/docs/FolderTree";
import { Uploader } from "@/components/docs/Uploader";
import { VersionDrawer, type VersionRow } from "@/components/docs/VersionDrawer";
import { btnDanger, btnGhost, card, input, td, th } from "@/components/ui";
import { db } from "@/lib/db";
import { FolderPermissions } from "@/components/docs/FolderPermissions";
import { getDocsContext } from "@/modules/docs/access";
import { createFolder, deleteFolder, renameFolder } from "@/modules/docs/actions";
import { FOLDER_LEVEL_LABELS, levelAtLeast } from "@/modules/docs/folder-permissions";
import { isViewable } from "@/modules/docs/markup";
import { ancestors, fileKind, formatBytes, parseSort, sortFolderNames, sortItems, type SortKey } from "@/modules/docs/logic";

type Search = { view?: string; sort?: string; dir?: string };

export default async function FolderPage({ params, searchParams }: { params: Promise<{ projectId: string; folderId: string }>; searchParams: Promise<Search> }) {
  const { projectId, folderId } = await params;
  const sp = await searchParams;
  const docsCtx = await getDocsContext(projectId);
  const { project } = docsCtx;
  // folder-level access (see modules/docs/folder-permissions.ts); 404 rather than reveal the folder exists
  const level = docsCtx.levelOn(folderId);
  if (!levelAtLeast(level, "VIEW")) notFound();
  const canDownload = levelAtLeast(level, "VIEW_DOWNLOAD");
  const canUpload = levelAtLeast(level, "UPLOAD");
  const canCreate = levelAtLeast(level, "EDIT");
  const canManage = levelAtLeast(level, "MANAGE");
  const { visible: shown, openable } = docsCtx.visible();

  const allFolders = await db.folder.findMany({ where: { projectId }, select: { id: true, parentId: true, name: true, root: true, updatedAt: true } });
  const folder = allFolders.find((f) => f.id === folderId);
  if (!folder) notFound();
  const crumbs = ancestors(allFolders, folderId);
  const subfolders = sortFolderNames(allFolders.filter((f) => f.parentId === folderId && shown.has(f.id)));
  const docs = await db.document.findMany({
    where: { folderId },
    include: { versions: { orderBy: { number: "desc" }, include: { uploadedBy: { select: { name: true } } } } },
  });

  const view = sp.view === "grid" ? "grid" : "list";
  const { sort, dir } = parseSort(sp.sort, sp.dir);
  const sorted = sortItems(docs, sort, dir);
  const base = `/projects/${projectId}/docs/folders/${folderId}`;
  const href = (p: Partial<{ view: string; sort: string; dir: string }>) => {
    const q = new URLSearchParams({ view, sort, dir, ...p });
    return `${base}?${q}`;
  };
  const sortHref = (key: SortKey) => href({ sort: key, dir: sort === key ? (dir === "asc" ? "desc" : "asc") : key === "name" ? "asc" : "desc" });
  const arrow = (key: SortKey) => (sort === key ? (dir === "asc" ? " ↑" : " ↓") : "");
  const ariaSort = (key: SortKey) => (sort === key ? (dir === "asc" ? "ascending" : "descending") : undefined);

  const fmt = new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeStyle: "short", timeZone: project.timezone });
  const fmtDate = new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeZone: project.timezone });
  const versionRows = (d: (typeof docs)[number]): VersionRow[] =>
    d.versions.map((v) => ({
      id: v.id,
      number: v.number,
      size: v.size,
      uploadedBy: v.uploadedBy?.name ?? "Former member",
      createdAt: fmt.format(v.createdAt),
      downloadHref: canDownload ? `/api/projects/${projectId}/versions/${v.id}` : null,
      viewHref: isViewable(v.contentType, v.fileName) ? `/projects/${projectId}/viewer/${v.id}` : null,
    }));
  const viewHref = (versionId: string) => `/projects/${projectId}/viewer/${versionId}`;
  const folderHref = (id: string) => `/projects/${projectId}/docs/folders/${id}?view=${view}`;
  const empty = subfolders.length === 0 && sorted.length === 0;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm text-ink-soft">
          {crumbs.map((c, i) => (
            <span key={c.id} className="flex items-center gap-1">
              {i > 0 && <span aria-hidden>/</span>}
              {i === crumbs.length - 1 ? (
                <span aria-current="page" className="font-medium text-ink">{c.name}</span>
              ) : (
                openable.has(c.id) ? <Link className="hover:text-ink hover:underline" href={folderHref(c.id)}>{c.name}</Link> : <span>{c.name}</span>
              )}
            </span>
          ))}
        </nav>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">{folder.name}</h2>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs text-ink-soft" data-testid="my-access">Your access: {FOLDER_LEVEL_LABELS[level]}</span>
            {sorted.length > 0 && (
              <Link href={`/projects/${projectId}/reviews/new?folderId=${folderId}`} className={btnGhost} data-testid="submit-for-review">
                Submit for review
              </Link>
            )}
            {canUpload && <Uploader projectId={projectId} folderId={folderId} />}
          </div>
        </div>
      </div>

      {(canCreate || (canManage && !folder.root)) && (
        <div className="flex flex-wrap gap-2">
          {canCreate && (
            <details className="group">
              <summary className={`${btnGhost} cursor-pointer list-none`}>New folder</summary>
              <ActionForm action={createFolder.bind(null, projectId, folderId)} className="mt-2 flex flex-wrap gap-2" testId="new-folder-form">
                <input className={`${input} w-56`} name="name" aria-label="Folder name" placeholder="e.g. Architectural" required maxLength={200} />
                <SubmitButton>Create</SubmitButton>
              </ActionForm>
            </details>
          )}
          {canManage && !folder.root && (
            <>
              <details>
                <summary className={`${btnGhost} cursor-pointer list-none`}>Rename</summary>
                <ActionForm action={renameFolder.bind(null, projectId, folderId)} className="mt-2 flex flex-wrap gap-2" resetOnSuccess={false} testId="rename-folder-form">
                  <input className={`${input} w-56`} name="name" aria-label="New folder name" defaultValue={folder.name} required maxLength={200} />
                  <SubmitButton>Save name</SubmitButton>
                </ActionForm>
              </details>
              <form action={deleteFolder.bind(null, projectId, folderId)}>
                <ConfirmButton
                  className={`${btnDanger} py-2`}
                  message={`Delete "${folder.name}" and everything in it? Files and all their versions will be removed.`}
                >
                  Delete folder
                </ConfirmButton>
              </form>
            </>
          )}
        </div>
      )}

      {canManage && <FolderPermissions projectId={projectId} folderId={folderId} />}

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="flex items-center gap-1" role="group" aria-label="Sort by">
          <span className="text-ink-soft">Sort:</span>
          {(["name", "date", "size"] as const).map((k) => (
            <Link key={k} href={sortHref(k)} className={`rounded px-2 py-1 ${sort === k ? "bg-muted font-medium" : "text-ink-soft hover:bg-muted"}`}>
              {k === "name" ? "Name" : k === "date" ? "Date" : "Size"}
              {arrow(k)}
            </Link>
          ))}
        </div>
        <div className="flex overflow-hidden rounded-md border border-line" role="group" aria-label="View">
          <Link href={href({ view: "list" })} aria-current={view === "list" ? "true" : undefined} className={`px-3 py-1 ${view === "list" ? "bg-brand text-white" : "bg-surface hover:bg-muted"}`}>List</Link>
          <Link href={href({ view: "grid" })} aria-current={view === "grid" ? "true" : undefined} className={`px-3 py-1 ${view === "grid" ? "bg-brand text-white" : "bg-surface hover:bg-muted"}`}>Grid</Link>
        </div>
      </div>

      {empty ? (
        <div className={`${card} p-8 text-center text-sm text-ink-soft`}>
          This folder is empty.{canUpload && " Upload files to get started."}
        </div>
      ) : view === "list" ? (
        <div className={`${card} overflow-x-auto`}>
          <table className="w-full" data-testid="file-table">
            <thead className="border-b border-line bg-muted/50">
              <tr>
                <th className={th} aria-sort={ariaSort("name")}>Name</th>
                <th className={th}>Version</th>
                <th className={`${th} hidden sm:table-cell`} aria-sort={ariaSort("size")}>Size</th>
                <th className={`${th} hidden md:table-cell`} aria-sort={ariaSort("date")}>Updated</th>
                <th className={`${th} hidden lg:table-cell`}>Updated by</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {subfolders.map((f) => (
                <tr key={f.id} data-testid="folder-row">
                  <td className={td} colSpan={5}>
                    {openable.has(f.id) ? (
                      <Link href={folderHref(f.id)} className="flex items-center gap-2 font-medium hover:underline">
                        <FolderGlyph /> {f.name}
                      </Link>
                    ) : (
                      <span className="flex items-center gap-2 text-ink-soft" title="You can only open the shared folders inside this one">
                        <FolderGlyph /> {f.name}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {sorted.map((d) => (
                <tr key={d.id} data-testid="file-row">
                  <td className={td}>
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="w-12 shrink-0 rounded bg-muted px-1 py-0.5 text-center text-[10px] font-semibold uppercase text-ink-soft">{fileKind(d.name)}</span>
                      {canDownload ? (
                        <a href={`/api/projects/${projectId}/versions/${d.versions[0]?.id}`} className="break-all font-medium hover:underline" data-testid="download-link">{d.name}</a>
                      ) : (
                        <span className="break-all font-medium">{d.name}</span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-ink-soft sm:hidden">{formatBytes(d.size)} · {fmtDate.format(d.updatedAt)}</p>
                  </td>
                  <td className={td}>
                    <div className="flex items-center gap-2">
                      <VersionDrawer name={d.name} versions={versionRows(d)} />
                      {isViewable(d.contentType, d.name) && d.versions[0] && (
                        <Link href={viewHref(d.versions[0].id)} className="text-xs font-medium text-brand hover:underline" aria-label={`Open ${d.name} in the viewer`} data-testid="view-link">
                          View
                        </Link>
                      )}
                    </div>
                  </td>
                  <td className={`${td} hidden whitespace-nowrap sm:table-cell`}>{formatBytes(d.size)}</td>
                  <td className={`${td} hidden whitespace-nowrap md:table-cell`}>{fmt.format(d.updatedAt)}</td>
                  <td className={`${td} hidden lg:table-cell`}>{d.versions[0]?.uploadedBy?.name ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" data-testid="file-grid">
          {subfolders.map((f) => (
            <li key={f.id} className={`${card} p-3`}>
              {openable.has(f.id) ? (
                <Link href={folderHref(f.id)} className="flex flex-col gap-2 font-medium hover:underline">
                  <span className="flex h-16 items-center justify-center rounded bg-muted"><FolderGlyph /></span>
                  <span className="truncate text-sm">{f.name}</span>
                </Link>
              ) : (
                <span className="flex flex-col gap-2 text-ink-soft">
                  <span className="flex h-16 items-center justify-center rounded bg-muted"><FolderGlyph /></span>
                  <span className="truncate text-sm">{f.name}</span>
                </span>
              )}
            </li>
          ))}
          {sorted.map((d) => (
            <li key={d.id} className={`${card} flex flex-col gap-2 p-3`} data-testid="file-card">
              {canDownload ? (
                <a href={`/api/projects/${projectId}/versions/${d.versions[0]?.id}`} className="flex h-16 items-center justify-center rounded bg-muted text-sm font-semibold text-ink-soft">
                  {fileKind(d.name)}
                </a>
              ) : (
                <span className="flex h-16 items-center justify-center rounded bg-muted text-sm font-semibold text-ink-soft">{fileKind(d.name)}</span>
              )}
              <p className="truncate text-sm font-medium" title={d.name}>{d.name}</p>
              {isViewable(d.contentType, d.name) && d.versions[0] && (
                <Link href={viewHref(d.versions[0].id)} className="text-xs font-medium text-brand hover:underline" aria-label={`Open ${d.name} in the viewer`}>
                  View
                </Link>
              )}
              <div className="flex items-center justify-between text-xs text-ink-soft">
                <VersionDrawer name={d.name} versions={versionRows(d)} />
                <span>{formatBytes(d.size)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { TreeNode } from "@/modules/docs/logic";
import { FolderTree } from "./FolderTree";

/** Folders / Sets toggle above the left panel; Sets lists the project's sheet sets. */
export function DocsSidebar({ projectId, tree, sets }: { projectId: string; tree: TreeNode[]; sets: { id: string; name: string; count: number }[] }) {
  const pathname = usePathname();
  const base = `/projects/${projectId}/docs`;
  const inSets = pathname.startsWith(`${base}/sets`) || pathname.startsWith(`${base}/sheets`);
  const tab = (active: boolean) =>
    `flex-1 px-3 py-1.5 text-center text-sm font-medium ${active ? "bg-brand text-white" : "bg-surface text-ink hover:bg-muted"}`;
  return (
    <div className="space-y-3">
      <div className="flex overflow-hidden rounded-md border border-line" role="group" aria-label="Browse by">
        <Link href={base} className={tab(!inSets)} aria-current={!inSets ? "page" : undefined}>Folders</Link>
        <Link href={`${base}/sets`} className={tab(inSets)} aria-current={inSets ? "page" : undefined}>Sets</Link>
      </div>
      {inSets ? (
        <nav aria-label="Sheet sets" data-testid="sets-nav">
          <ul className="space-y-0.5 text-sm">
            <li>
              <Link
                href={`${base}/sets`}
                aria-current={pathname === `${base}/sets` ? "page" : undefined}
                className={`block rounded px-2 py-1.5 ${pathname === `${base}/sets` ? "bg-brand/10 font-medium text-brand" : "hover:bg-muted"}`}
              >
                All current sheets
              </Link>
            </li>
            {sets.map((s) => {
              const href = `${base}/sets/${s.id}`;
              const active = pathname === href;
              return (
                <li key={s.id}>
                  <Link href={href} aria-current={active ? "page" : undefined} className={`flex justify-between gap-2 rounded px-2 py-1.5 ${active ? "bg-brand/10 font-medium text-brand" : "hover:bg-muted"}`}>
                    <span className="truncate">{s.name}</span>
                    <span className="text-xs text-ink-soft">{s.count}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {sets.length === 0 && <p className="mt-2 px-2 text-xs text-ink-soft">No sets yet.</p>}
        </nav>
      ) : (
        <FolderTree projectId={projectId} tree={tree} />
      )}
    </div>
  );
}

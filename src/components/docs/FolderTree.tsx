"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { TreeNode } from "@/modules/docs/logic";

const storeKey = (projectId: string) => `bushbim.docs.tree.${projectId}`;

function ancestorIds(nodes: TreeNode[], target: string, trail: string[] = []): string[] | null {
  for (const n of nodes) {
    if (n.id === target) return trail;
    const found = ancestorIds(n.children, target, [...trail, n.id]);
    if (found) return found;
  }
  return null;
}

/** Left-hand folder tree. Expanded state is remembered per project in this browser. */
export function FolderTree({ projectId, tree }: { projectId: string; tree: TreeNode[] }) {
  const pathname = usePathname();
  const activeId = /\/docs\/folders\/([^/?#]+)/.exec(pathname)?.[1] ?? null;
  const [open, setOpen] = useState<Set<string>>(() => new Set(tree.map((r) => r.id)));
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storeKey(projectId)) ?? "null");
      if (Array.isArray(saved)) setOpen(new Set(saved.filter((s): s is string => typeof s === "string")));
    } catch {
      /* storage unavailable: keep defaults */
    }
  }, [projectId]);

  // always reveal the folder being viewed, and show its own subfolders
  const trail = useMemo(() => {
    const up = activeId ? ancestorIds(tree, activeId) : null;
    return up && activeId ? [...up, activeId] : [];
  }, [tree, activeId]);
  useEffect(() => {
    if (!trail.length) return;
    setOpen((prev) => (trail.every((id) => prev.has(id)) ? prev : new Set([...prev, ...trail])));
  }, [trail]);
  useEffect(() => setMobileOpen(false), [pathname]);

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(storeKey(projectId), JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });

  const render = (nodes: TreeNode[], depth: number) => (
    <ul role={depth === 0 ? "tree" : "group"} aria-label={depth === 0 ? "Folders" : undefined}>
      {nodes.map((n) => {
        const isOpen = open.has(n.id);
        const hasKids = n.children.length > 0;
        return (
          <li key={n.id} role="treeitem" aria-expanded={hasKids ? isOpen : undefined} aria-selected={n.id === activeId}>
            <div className="flex items-center" style={{ paddingLeft: depth * 14 }}>
              {hasKids ? (
                <button
                  type="button"
                  onClick={() => toggle(n.id)}
                  aria-label={`${isOpen ? "Collapse" : "Expand"} ${n.name}`}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-ink-soft hover:bg-muted"
                >
                  <span aria-hidden className={`inline-block transition-transform ${isOpen ? "rotate-90" : ""}`}>›</span>
                </button>
              ) : (
                <span className="w-7 shrink-0" />
              )}
              {n.locked ? (
                <span
                  className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-sm text-ink-soft"
                  title="You can only open the shared folders inside this one"
                >
                  <FolderGlyph root={!!n.root} />
                  <span className="truncate">{n.name}</span>
                </span>
              ) : (
              <Link
                href={`/projects/${projectId}/docs/folders/${n.id}`}
                aria-current={n.id === activeId ? "page" : undefined}
                className={`flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1.5 text-sm ${n.id === activeId ? "bg-brand/10 font-medium text-brand" : "text-ink hover:bg-muted"}`}
              >
                <FolderGlyph root={!!n.root} />
                <span className="truncate">{n.name}</span>
              </Link>
              )}
            </div>
            {hasKids && isOpen && render(n.children, depth + 1)}
          </li>
        );
      })}
    </ul>
  );

  return (
    <div>
      <button
        type="button"
        className="mb-2 flex w-full items-center justify-between rounded-md border border-line bg-surface px-3 py-2 text-sm font-medium md:hidden"
        aria-expanded={mobileOpen}
        onClick={() => setMobileOpen((v) => !v)}
      >
        Folders <span aria-hidden>{mobileOpen ? "▴" : "▾"}</span>
      </button>
      <nav aria-label="Folder tree" className={`${mobileOpen ? "block" : "hidden"} md:block`} data-testid="folder-tree">
        {render(tree, 0)}
      </nav>
    </div>
  );
}

export function FolderGlyph({ root = false }: { root?: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 20 16" className={`h-4 w-4 shrink-0 ${root ? "text-brand" : "text-accent"}`} fill="currentColor">
      <path d="M1 2.5A1.5 1.5 0 0 1 2.5 1h5l2 2h8A1.5 1.5 0 0 1 19 4.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 1 13.5z" />
    </svg>
  );
}

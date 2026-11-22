"use client";

import { useEffect, useRef, useState } from "react";
import { badge, btnGhost } from "@/components/ui";
import { formatBytes } from "@/modules/docs/logic";

export interface VersionRow {
  id: string;
  number: number;
  size: number;
  uploadedBy: string;
  createdAt: string; // preformatted in the project timezone
  downloadHref: string;
}

/** The "V3" badge opens a side drawer listing every version with a download link. */
export function VersionDrawer({ name, versions }: { name: string; versions: VersionRow[] }) {
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const latest = versions[0];

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${badge} bg-brand/10 text-brand hover:bg-brand/20`}
        aria-label={`Version history for ${name} (V${latest?.number ?? 1})`}
      >
        V{latest?.number ?? 1}
      </button>
      {open && (
        <div className="fixed inset-0 z-40 flex justify-end">
          <button type="button" aria-label="Close version history" className="absolute inset-0 bg-black/30" tabIndex={-1} onClick={() => setOpen(false)} />
          <aside role="dialog" aria-modal="true" aria-label={`Version history: ${name}`} className="relative flex h-full w-full max-w-md flex-col bg-surface shadow-xl">
            <div className="flex items-start justify-between gap-3 border-b border-line p-4">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wide text-ink-soft">Version history</p>
                <h3 className="truncate font-semibold" title={name}>{name}</h3>
              </div>
              <button ref={closeRef} type="button" className={btnGhost} onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
            <ol className="flex-1 divide-y divide-line overflow-y-auto">
              {versions.map((v, i) => (
                <li key={v.id} className="flex items-center justify-between gap-3 p-4" data-testid="version-row">
                  <div className="min-w-0 text-sm">
                    <p className="font-medium">
                      V{v.number} {i === 0 && <span className={`${badge} ml-1 bg-emerald-100 text-emerald-800`}>Current</span>}
                    </p>
                    <p className="text-xs text-ink-soft">
                      {v.createdAt} · {v.uploadedBy} · {formatBytes(v.size)}
                    </p>
                  </div>
                  <a href={v.downloadHref} className={btnGhost} aria-label={`Download V${v.number}`}>
                    Download
                  </a>
                </li>
              ))}
            </ol>
          </aside>
        </div>
      )}
    </>
  );
}

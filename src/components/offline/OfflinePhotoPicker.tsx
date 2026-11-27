"use client";

import { useState } from "react";
import { compressPhoto } from "@/components/issues/compress";
import { MAX_PHOTOS_PER_UPLOAD } from "@/modules/issues/media";
import type { PhotoTarget } from "@/modules/offline/logic";
import { queuePhoto } from "./photos";

/** Adds photos to something that exists only on this device so far (an issue created offline). */
export function OfflinePhotoPicker({ projectId, target }: { projectId: string; target: PhotoTarget }) {
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function add(list: FileList | null) {
    const files = Array.from(list ?? []).slice(0, MAX_PHOTOS_PER_UPLOAD);
    if (!files.length) return;
    setBusy(true);
    setError(null);
    try {
      for (const f of files) {
        await queuePhoto(projectId, target, f.name, "", await compressPhoto(f));
        setCount((n) => n + 1);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-3 rounded-md border border-dashed border-line p-3 text-sm" data-testid="offline-photo-picker">
      <label className="inline-flex cursor-pointer items-center gap-2 font-medium text-brand">
        {busy ? "Compressing…" : "Add photos to this issue"}
        <input type="file" accept="image/*" multiple className="sr-only" disabled={busy} onChange={(e) => void add(e.target.files)} aria-label="Choose photos for the offline issue" />
      </label>
      {count > 0 && <p className="mt-1 text-ink-soft" data-testid="offline-photo-count">{count === 1 ? "1 photo" : `${count} photos`} saved on this device.</p>}
      {error && <p role="alert" className="mt-1 text-red-700">{error}</p>}
    </div>
  );
}

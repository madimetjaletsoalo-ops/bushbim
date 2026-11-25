"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { input, label } from "@/components/ui";
import { formatBytes } from "@/modules/docs/logic";
import { completePhotoUpload, requestPhotoUploads } from "@/modules/issues/media-actions";
import { MAX_CAPTION, MAX_PHOTOS_PER_UPLOAD, PHOTO_MAX_WIDTH } from "@/modules/issues/media";
import { compressPhoto, type Compressed } from "./compress";

type Row = { id: number; name: string; state: "compressing" | "uploading" | "done" | "error"; note?: string };

function put(url: string, headers: Record<string, string>, body: Blob): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error("Network error. Check your connection and try again."));
    xhr.send(body);
  });
}

/**
 * Adds photos to an issue (or the project gallery when issueId is null).
 * Each photo is compressed here to a JPEG at most 1600 px wide before it is sent.
 */
export function PhotoUploader({ projectId, issueId }: { projectId: string; issueId: string | null }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [caption, setCaption] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const patch = (id: number, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));

  async function start(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (!files.length || busy) return;
    setError(null);
    if (files.length > MAX_PHOTOS_PER_UPLOAD) return setError(`Add up to ${MAX_PHOTOS_PER_UPLOAD} photos at a time.`);
    setBusy(true);
    const base = Date.now();
    const newRows: Row[] = files.map((f, i) => ({ id: base + i, name: f.name, state: "compressing" }));
    setRows(newRows);
    try {
      // compress one at a time: phones run out of memory decoding several 12 MP photos at once
      const done: { row: Row; file: File; c: Compressed }[] = [];
      for (let i = 0; i < files.length; i++) {
        try {
          done.push({ row: newRows[i], file: files[i], c: await compressPhoto(files[i]) });
        } catch (e) {
          patch(newRows[i].id, { state: "error", note: (e as Error).message });
        }
      }
      if (!done.length) return;
      const res = await requestPhotoUploads(projectId, issueId, done.map((d) => ({ name: d.file.name, size: d.c.photo.size, thumbSize: d.c.thumb.size })));
      if (!res.ok) {
        setError(res.error);
        for (const d of done) patch(d.row.id, { state: "error", note: "Not uploaded" });
        return;
      }
      for (let i = 0; i < done.length; i++) {
        const { row, c, file } = done[i];
        const t = res.tickets[i];
        patch(row.id, { state: "uploading", note: `${formatBytes(file.size)} → ${formatBytes(c.photo.size)}` });
        try {
          await put(t.main.url, t.main.headers, c.photo);
          await put(t.thumb.url, t.thumb.headers, c.thumb);
          const saved = await completePhotoUpload(projectId, t.token, caption);
          if (saved.ok) patch(row.id, { state: "done", note: `Saved, ${c.width}×${c.height}, ${formatBytes(c.photo.size)}` });
          else patch(row.id, { state: "error", note: saved.error });
        } catch (e) {
          patch(row.id, { state: "error", note: (e as Error).message });
        }
      }
      setCaption("");
      router.refresh();
    } catch {
      setError("Upload failed. Check your connection and try again.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const fieldId = `photo-input-${issueId ?? "project"}`;
  return (
    <div className="space-y-2" data-testid="photo-uploader">
      <div>
        <label className={label} htmlFor={`${fieldId}-caption`}>Caption (optional)</label>
        <input id={`${fieldId}-caption`} className={input} value={caption} maxLength={MAX_CAPTION} onChange={(e) => setCaption(e.target.value)} disabled={busy} />
      </div>
      <div>
        <label htmlFor={fieldId} className={`inline-flex cursor-pointer items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-dark ${busy ? "pointer-events-none opacity-50" : ""}`}>
          {busy ? "Adding photos…" : "Add photos"}
        </label>
        <input
          ref={inputRef}
          id={fieldId}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          aria-label="Choose photos"
          disabled={busy}
          onChange={(e) => void start(e.target.files)}
        />
        <p className="mt-1 text-xs text-ink-soft">Photos are compressed on your device to at most {PHOTO_MAX_WIDTH} px wide before upload.</p>
      </div>
      {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {rows.length > 0 && (
        <ul className="space-y-1 text-sm" data-testid="photo-upload-list">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-baseline gap-x-2">
              <span className="max-w-[12rem] truncate font-medium" title={r.name}>{r.name}</span>
              <span className={r.state === "error" ? "text-red-700" : r.state === "done" ? "text-emerald-700" : "text-ink-soft"}>
                {r.state === "compressing" ? "Compressing…" : r.state === "uploading" ? `Uploading… ${r.note ?? ""}` : r.note}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

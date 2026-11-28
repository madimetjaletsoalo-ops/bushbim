"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { input, label } from "@/components/ui";
import { formatBytes } from "@/modules/docs/logic";
import { completeChecklistPhotoUpload, requestChecklistPhotoUploads } from "@/modules/checklists/media-actions";
import { completeDailyLogPhotoUpload, requestDailyLogPhotoUploads } from "@/modules/daily-logs/media-actions";
import { completePhotoUpload, requestPhotoUploads } from "@/modules/issues/media-actions";
import { MAX_CAPTION, MAX_PHOTOS_PER_UPLOAD, PHOTO_MAX_WIDTH } from "@/modules/issues/media";
import { compressPhoto, type Compressed } from "./compress";
import { queuePhoto } from "@/components/offline/photos";
import { isNetworkError, type PhotoTarget } from "@/modules/offline/logic";

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
export function PhotoUploader({
  projectId,
  issueId,
  checklistItem,
  dailyLogId,
  label: buttonLabel = "Add photos",
}: {
  projectId: string;
  issueId: string | null;
  /** answer a checklist photo item instead of adding to an issue */
  checklistItem?: { checklistId: string; itemId: string };
  /** add to a daily log instead of an issue */
  dailyLogId?: string;
  label?: string;
}) {
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
      // no connection: keep the compressed photos on this device and sync them later
      const target: PhotoTarget | null = checklistItem
        ? { type: "checklist", checklistId: checklistItem.checklistId, itemId: checklistItem.itemId }
        : dailyLogId
          ? null
          : issueId
            ? { type: "issue", issueId }
            : { type: "project" };
      const keepOffline = async () => {
        if (!target) {
          setError("Daily log photos need a connection. Try again when you're back online.");
          for (const d of done) patch(d.row.id, { state: "error", note: "Not uploaded" });
          return;
        }
        for (const d of done) {
          try {
            await queuePhoto(projectId, target, d.file.name, caption, d.c);
            patch(d.row.id, { state: "done", note: "Saved on this device. It will upload when you're back online." });
          } catch (e) {
            patch(d.row.id, { state: "error", note: (e as Error).message });
          }
        }
        setCaption("");
      };
      if (!navigator.onLine) return void (await keepOffline());
      const specs = done.map((d) => ({ name: d.file.name, size: d.c.photo.size, thumbSize: d.c.thumb.size }));
      let res: Awaited<ReturnType<typeof requestPhotoUploads>>;
      try {
        res = checklistItem
          ? await requestChecklistPhotoUploads(projectId, checklistItem.checklistId, checklistItem.itemId, specs)
          : dailyLogId
            ? await requestDailyLogPhotoUploads(projectId, dailyLogId, specs)
            : await requestPhotoUploads(projectId, issueId, specs);
      } catch (e) {
        if (isNetworkError(e)) return void (await keepOffline());
        throw e;
      }
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
          const saved = checklistItem
            ? await completeChecklistPhotoUpload(projectId, t.token, caption)
            : dailyLogId
              ? await completeDailyLogPhotoUpload(projectId, t.token, caption)
              : await completePhotoUpload(projectId, t.token, caption);
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

  const fieldId = `photo-input-${checklistItem?.itemId ?? dailyLogId ?? issueId ?? "project"}`;
  return (
    <div className="space-y-2" data-testid="photo-uploader">
      <div>
        <label className={label} htmlFor={`${fieldId}-caption`}>Caption (optional)</label>
        <input id={`${fieldId}-caption`} className={input} value={caption} maxLength={MAX_CAPTION} onChange={(e) => setCaption(e.target.value)} disabled={busy} />
      </div>
      <div>
        <label htmlFor={fieldId} className={`inline-flex cursor-pointer items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-dark ${busy ? "pointer-events-none opacity-50" : ""}`}>
          {busy ? "Adding photos…" : buttonLabel}
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

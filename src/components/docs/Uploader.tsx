"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { btn } from "@/components/ui";
import { completeUpload, requestUploads, type UploadTicket } from "@/modules/docs/actions";
import { MAX_FILES_PER_UPLOAD, MAX_UPLOAD_BYTES, formatBytes } from "@/modules/docs/logic";

type Row = { id: number; name: string; size: number; loaded: number; state: "waiting" | "uploading" | "done" | "error"; note?: string };

const PARALLEL = 3;

function put(ticket: UploadTicket, file: File, onProgress: (loaded: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", ticket.url);
    for (const [k, v] of Object.entries(ticket.headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error("Network error. Check your connection and try again."));
    xhr.send(file);
  });
}

/** Multi-file uploader: presigned PUT per file with a progress bar each. */
export function Uploader({ projectId, folderId }: { projectId: string; folderId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  const patch = (id: number, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));

  async function start(list: FileList | File[]) {
    const files = Array.from(list);
    if (!files.length || busy) return;
    setError(null);
    if (files.length > MAX_FILES_PER_UPLOAD) return setError(`Upload up to ${MAX_FILES_PER_UPLOAD} files at a time.`);
    const tooBig = files.find((f) => f.size > MAX_UPLOAD_BYTES);
    if (tooBig) return setError(`${tooBig.name} is larger than ${formatBytes(MAX_UPLOAD_BYTES)}.`);
    setBusy(true);
    const base = Date.now();
    const newRows: Row[] = files.map((f, i) => ({ id: base + i, name: f.name, size: f.size, loaded: 0, state: "waiting" }));
    setRows(newRows);
    try {
      const res = await requestUploads(projectId, folderId, files.map((f) => ({ name: f.name, size: f.size, type: f.type })));
      if (!res.ok) {
        setError(res.error);
        setRows([]);
        return;
      }
      let next = 0;
      const worker = async () => {
        while (next < files.length) {
          const i = next++;
          const row = newRows[i];
          patch(row.id, { state: "uploading" });
          try {
            await put(res.tickets[i], files[i], (loaded) => patch(row.id, { loaded }));
            const done = await completeUpload(projectId, res.tickets[i].token);
            if (done.ok) patch(row.id, { state: "done", loaded: row.size, note: `Saved as V${done.version}` });
            else patch(row.id, { state: "error", note: done.error });
          } catch (e) {
            patch(row.id, { state: "error", note: (e as Error).message });
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(PARALLEL, files.length) }, worker));
      router.refresh();
    } catch {
      setError("Upload failed. Check your connection and try again.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void start(e.dataTransfer.files);
      }}
      className={dragging ? "rounded-md ring-2 ring-brand" : undefined}
    >
      <label className={`${btn} cursor-pointer ${busy ? "pointer-events-none opacity-50" : ""}`}>
        {busy ? "Uploading…" : "Upload files"}
        <input
          ref={inputRef}
          type="file"
          multiple
          className="sr-only"
          aria-label="Choose files to upload"
          disabled={busy}
          onChange={(e) => e.target.files && void start(e.target.files)}
        />
      </label>
      {error && (
        <p role="alert" className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
      {rows.length > 0 && (
        <ul className="mt-3 space-y-2" aria-label="Uploads" data-testid="upload-list">
          {rows.map((r) => (
            <li key={r.id} className="text-xs">
              <div className="flex justify-between gap-2">
                <span className="truncate font-medium">{r.name}</span>
                <span className={r.state === "error" ? "text-red-700" : "text-ink-soft"}>
                  {r.state === "done" || r.state === "error" ? r.note : `${formatBytes(r.loaded)} / ${formatBytes(r.size)}`}
                </span>
              </div>
              <progress
                className="mt-1 h-1.5 w-full overflow-hidden rounded accent-[var(--brand)]"
                max={Math.max(r.size, 1)}
                value={r.state === "done" ? Math.max(r.size, 1) : r.loaded}
                aria-label={`Upload progress for ${r.name}`}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

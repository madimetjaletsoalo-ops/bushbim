"use server";

import { randomBytes } from "node:crypto";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getProjectContext } from "@/lib/auth";
import { can, type Action } from "@/lib/permissions";
import { getStorage, type PresignedPut } from "@/lib/storage";
import type { ActionState } from "@/modules/admin/types";
import { MAX_FILES_PER_UPLOAD, MAX_UPLOAD_BYTES, checkName, nameKey, storageKey, subtreeIds, versionLabel } from "./logic";
import { secretBytes, signToken, uploadClaims, verifyToken } from "./token";

const UPLOAD_TOKEN_TTL = 60 * 60;

/** Re-checks project access and the DOCS permission for every docs action. */
async function docsAccess(projectId: string, action: Action) {
  const ctx = await getProjectContext(projectId);
  if (!can(ctx.member, "DOCS", action, ctx.grants)) return null;
  return ctx;
}

async function findFolder(projectId: string, folderId: string) {
  return db.folder.findFirst({ where: { id: folderId, projectId } });
}

const fail = (error: string): ActionState => ({ ok: false, error });
const revalidateDocs = (projectId: string) => revalidatePath(`/projects/${projectId}/docs`, "layout");
const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

const idSchema = z.string().min(1).max(64);
const nameField = z.object({ name: z.string().max(400) });

// ---------- folders ----------

export async function createFolder(projectId: string, parentId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await docsAccess(projectId, "create");
  if (!ctx) return fail("You don't have permission to create folders here.");
  const parsed = nameField.safeParse({ name: form.get("name") ?? "" });
  if (!parsed.success || !idSchema.safeParse(parentId).success) return fail("Invalid input");
  const checked = checkName(parsed.data.name);
  if (!checked.ok) return fail(checked.error);
  const parent = await findFolder(projectId, parentId);
  if (!parent) return fail("Folder not found");
  const siblings = await db.folder.findMany({ where: { parentId }, select: { name: true } });
  if (siblings.some((s) => nameKey(s.name) === nameKey(checked.name))) return fail("A folder with this name already exists here.");
  try {
    await db.$transaction(async (tx) => {
      const f = await tx.folder.create({ data: { projectId, parentId, name: checked.name, createdById: ctx.user.id } });
      await tx.auditEvent.create({
        data: { actorId: ctx.user.id, projectId, action: "folder.created", details: { folderId: f.id, name: f.name, parent: parent.name } },
      });
    });
  } catch (e) {
    if (isUniqueViolation(e)) return fail("A folder with this name already exists here.");
    throw e;
  }
  revalidateDocs(projectId);
  return { ok: true, message: `Created folder ${checked.name}` };
}

export async function renameFolder(projectId: string, folderId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await docsAccess(projectId, "manage");
  if (!ctx) return fail("You don't have permission to rename folders.");
  const parsed = nameField.safeParse({ name: form.get("name") ?? "" });
  if (!parsed.success || !idSchema.safeParse(folderId).success) return fail("Invalid input");
  const checked = checkName(parsed.data.name);
  if (!checked.ok) return fail(checked.error);
  const folder = await findFolder(projectId, folderId);
  if (!folder) return fail("Folder not found");
  if (folder.root) return fail(`"${folder.name}" is a top-level folder and can't be renamed.`);
  if (folder.name === checked.name) return { ok: true, message: "No change" };
  const siblings = await db.folder.findMany({ where: { parentId: folder.parentId, NOT: { id: folder.id } }, select: { name: true } });
  if (siblings.some((s) => nameKey(s.name) === nameKey(checked.name))) return fail("A folder with this name already exists here.");
  try {
    await db.$transaction(async (tx) => {
      await tx.folder.update({ where: { id: folder.id }, data: { name: checked.name } });
      await tx.auditEvent.create({
        data: { actorId: ctx.user.id, projectId, action: "folder.renamed", details: { folderId, from: folder.name, to: checked.name } },
      });
    });
  } catch (e) {
    if (isUniqueViolation(e)) return fail("A folder with this name already exists here.");
    throw e;
  }
  revalidateDocs(projectId);
  return { ok: true, message: `Renamed to ${checked.name}` };
}

/** Deletes a subfolder with everything in it (after the user confirms in the UI). */
export async function deleteFolder(projectId: string, folderId: string) {
  const ctx = await docsAccess(projectId, "manage");
  if (!ctx || !idSchema.safeParse(folderId).success) return;
  const folder = await findFolder(projectId, folderId);
  if (!folder || folder.root || !folder.parentId) return;
  const all = await db.folder.findMany({ where: { projectId }, select: { id: true, parentId: true } });
  const ids = subtreeIds(all, folder.id);
  const versions = await db.documentVersion.findMany({
    where: { document: { folderId: { in: ids } } },
    select: { storageKey: true },
  });
  const documents = await db.document.count({ where: { folderId: { in: ids } } });
  await db.$transaction(async (tx) => {
    await tx.folder.delete({ where: { id: folder.id } }); // cascades to subfolders, documents and versions
    await tx.auditEvent.create({
      data: {
        actorId: ctx.user.id,
        projectId,
        action: "folder.deleted",
        details: { folderId, name: folder.name, subfolders: ids.length - 1, documents, versions: versions.length },
      },
    });
  });
  // Stored objects are removed after the rows are gone; a failure here only leaves orphans.
  try {
    await getStorage().remove(versions.map((v) => v.storageKey));
  } catch (e) {
    console.error("docs: failed to remove stored files", e);
  }
  revalidateDocs(projectId);
  redirect(`/projects/${projectId}/docs/folders/${folder.parentId}`);
}

// ---------- uploads ----------

const fileSpec = z.object({
  name: z.string().max(400),
  size: z.number().int().nonnegative().max(MAX_UPLOAD_BYTES, `Files must be ${MAX_UPLOAD_BYTES / 1024 / 1024} MB or smaller`),
  type: z.string().max(200).default(""),
});

export type UploadTicket = PresignedPut & { name: string; token: string };
export type RequestUploadsResult = { ok: true; tickets: UploadTicket[] } | { ok: false; error: string };

const safeContentType = (t: string) => (/^[\w.+-]+\/[\w.+-]+$/.test(t) ? t : "application/octet-stream");

/** Step 1: the browser asks for one presigned upload URL per file. */
export async function requestUploads(projectId: string, folderId: string, files: unknown): Promise<RequestUploadsResult> {
  const ctx = await docsAccess(projectId, "create");
  if (!ctx) return { ok: false, error: "You don't have permission to upload here." };
  const parsed = z.array(fileSpec).min(1).max(MAX_FILES_PER_UPLOAD).safeParse(files);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid files" };
  if (!idSchema.safeParse(folderId).success || !(await findFolder(projectId, folderId))) return { ok: false, error: "Folder not found" };
  const storage = getStorage();
  const tickets: UploadTicket[] = [];
  for (const f of parsed.data) {
    const checked = checkName(f.name);
    if (!checked.ok) return { ok: false, error: `${f.name}: ${checked.error}` };
    const ct = safeContentType(f.type);
    const key = storageKey(projectId, checked.name, randomBytes(16).toString("hex"));
    const put = await storage.presignPut(key, ct, f.size);
    const token = await signToken(
      { typ: "upload", pid: projectId, fid: folderId, uid: ctx.user.id, key, name: checked.name, size: f.size, ct },
      secretBytes(),
      UPLOAD_TOKEN_TTL,
    );
    tickets.push({ ...put, name: checked.name, token });
  }
  return { ok: true, tickets };
}

export type CompleteUploadResult = { ok: true; name: string; version: number } | { ok: false; error: string };

/**
 * Step 2: after the bytes are stored, record the document version.
 * A file whose name matches an existing document in the folder (ignoring case)
 * stacks as the next version: V2, V3…
 */
export async function completeUpload(projectId: string, token: string): Promise<CompleteUploadResult> {
  const ctx = await docsAccess(projectId, "create");
  if (!ctx) return { ok: false, error: "You don't have permission to upload here." };
  const c = typeof token === "string" ? await verifyToken(token, uploadClaims, secretBytes()) : null;
  if (!c || c.pid !== projectId || c.uid !== ctx.user.id) return { ok: false, error: "Upload link is invalid or has expired. Try again." };
  if (!(await findFolder(projectId, c.fid))) return { ok: false, error: "The folder was deleted during the upload." };
  if (await db.documentVersion.findUnique({ where: { storageKey: c.key } })) return { ok: false, error: "This upload was already saved." };
  const storage = getStorage();
  const stored = await storage.head(c.key);
  if (stored === null) return { ok: false, error: `${c.name} didn't finish uploading. Try again.` };
  if (stored !== c.size) {
    await storage.remove([c.key]).catch(() => {});
    return { ok: false, error: `${c.name} arrived incomplete. Try again.` };
  }

  const save = () =>
    db.$transaction(async (tx) => {
      const key = nameKey(c.name);
      const existing = await tx.document.findUnique({ where: { folderId_nameKey: { folderId: c.fid, nameKey: key } } });
      const doc = existing
        ? await tx.document.update({
            where: { id: existing.id },
            data: { currentVersion: { increment: 1 }, size: c.size, contentType: c.ct, updatedAt: new Date() },
          })
        : await tx.document.create({
            data: { projectId, folderId: c.fid, name: c.name, nameKey: key, currentVersion: 1, size: c.size, contentType: c.ct },
          });
      await tx.documentVersion.create({
        data: { documentId: doc.id, number: doc.currentVersion, storageKey: c.key, fileName: c.name, size: c.size, contentType: c.ct, uploadedById: ctx.user.id },
      });
      await tx.auditEvent.create({
        data: {
          actorId: ctx.user.id,
          projectId,
          action: existing ? "document.version_added" : "document.uploaded",
          details: { documentId: doc.id, name: doc.name, version: versionLabel(doc.currentVersion), size: c.size },
        },
      });
      return doc;
    });

  let doc;
  try {
    doc = await save();
  } catch (e) {
    // two uploads of a new name at once: the second retries and stacks
    if (!isUniqueViolation(e)) throw e;
    doc = await save();
  }
  revalidateDocs(projectId);
  return { ok: true, name: doc.name, version: doc.currentVersion };
}

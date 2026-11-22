"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { folderAccess, getDocsContext } from "./access";
import type { FolderLevel } from "./folder-permissions";
import { calibrate, calibrationInput, markupInput, type Pt } from "./markup";

// Markup rules (folder level on the document's folder):
// - view published markups, and add private ones: View
// - publish: Upload
// - delete: the author, or Manage for anyone's
// - calibrate the drawing scale (shared by everyone): Upload

export type MarkupDTO = {
  id: string;
  page: number;
  type: string;
  points: Pt[];
  color: string;
  text: string | null;
  status: "PRIVATE" | "PUBLISHED";
  authorId: string | null;
  authorName: string;
};

type Result<T> = { ok: true; data: T } | { ok: false; error: string };
const idSchema = z.string().min(1).max(64);

async function versionAccess(projectId: string, versionId: unknown, min: FolderLevel) {
  if (!idSchema.safeParse(versionId).success) return null;
  await getDocsContext(projectId); // signed-in project member, or redirect / 404
  const v = await db.documentVersion.findFirst({
    where: { id: versionId as string, document: { projectId } },
    include: { document: { select: { folderId: true, name: true } } },
  });
  if (!v) return null;
  const ctx = await folderAccess(projectId, v.document.folderId, min);
  return ctx ? { ...ctx, version: v } : null;
}

async function markupAccess(projectId: string, markupId: unknown) {
  if (!idSchema.safeParse(markupId).success) return null;
  const m = await db.markup.findFirst({ where: { id: markupId as string, version: { document: { projectId } } } });
  if (!m) return null;
  const ctx = await versionAccess(projectId, m.versionId, "VIEW");
  if (!ctx) return null;
  // someone else's private markup is invisible: behave as if it doesn't exist
  if (m.status === "PRIVATE" && m.authorId !== ctx.user.id) return null;
  return { ...ctx, markup: m };
}

const toDTO = (m: { id: string; page: number; type: string; points: unknown; color: string; text: string | null; status: "PRIVATE" | "PUBLISHED"; authorId: string | null }, authorName: string): MarkupDTO => ({
  id: m.id,
  page: m.page,
  type: m.type,
  points: m.points as Pt[],
  color: m.color,
  text: m.text,
  status: m.status,
  authorId: m.authorId,
  authorName,
});

export async function createMarkup(projectId: string, versionId: string, input: unknown): Promise<Result<MarkupDTO>> {
  const ctx = await versionAccess(projectId, versionId, "VIEW");
  if (!ctx) return { ok: false, error: "You don't have access to this file." };
  const parsed = markupInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid markup" };
  const d = parsed.data;
  const m = await db.$transaction(async (tx) => {
    const created = await tx.markup.create({
      data: { versionId, page: d.page, type: d.type, points: d.points, color: d.color, text: d.text || null, authorId: ctx.user.id },
    });
    await tx.auditEvent.create({
      data: { actorId: ctx.user.id, projectId, action: "markup.created", details: { markupId: created.id, document: ctx.version.document.name, version: ctx.version.number, page: d.page, type: d.type } },
    });
    return created;
  });
  return { ok: true, data: toDTO(m, ctx.user.name) };
}

export async function setMarkupStatus(projectId: string, markupId: string, status: unknown): Promise<Result<MarkupDTO>> {
  const ctx = await markupAccess(projectId, markupId);
  if (!ctx) return { ok: false, error: "Markup not found" };
  const s = z.enum(["PRIVATE", "PUBLISHED"]).safeParse(status);
  if (!s.success) return { ok: false, error: "Invalid status" };
  if (ctx.markup.authorId !== ctx.user.id) return { ok: false, error: "Only the author can publish or unpublish a markup." };
  if (s.data === "PUBLISHED" && !(await versionAccess(projectId, ctx.markup.versionId, "UPLOAD")))
    return { ok: false, error: "You need Upload access to this folder to publish markups." };
  const m = await db.$transaction(async (tx) => {
    const u = await tx.markup.update({ where: { id: ctx.markup.id }, data: { status: s.data } });
    await tx.auditEvent.create({
      data: { actorId: ctx.user.id, projectId, action: s.data === "PUBLISHED" ? "markup.published" : "markup.unpublished", details: { markupId: u.id, document: ctx.version.document.name } },
    });
    return u;
  });
  return { ok: true, data: toDTO(m, ctx.user.name) };
}

export async function deleteMarkup(projectId: string, markupId: string): Promise<Result<null>> {
  const ctx = await markupAccess(projectId, markupId);
  if (!ctx) return { ok: false, error: "Markup not found" };
  const mine = ctx.markup.authorId === ctx.user.id;
  if (!mine && !(await versionAccess(projectId, ctx.markup.versionId, "MANAGE")))
    return { ok: false, error: "Only the author or a folder manager can delete this markup." };
  await db.$transaction(async (tx) => {
    await tx.markup.delete({ where: { id: ctx.markup.id } });
    await tx.auditEvent.create({
      data: { actorId: ctx.user.id, projectId, action: "markup.deleted", details: { markupId: ctx.markup.id, document: ctx.version.document.name, type: ctx.markup.type, own: mine } },
    });
  });
  return { ok: true, data: null };
}

export async function setCalibration(projectId: string, versionId: string, input: unknown): Promise<Result<{ page: number; unitsPerPoint: number; unit: string }>> {
  const ctx = await versionAccess(projectId, versionId, "UPLOAD");
  if (!ctx) return { ok: false, error: "You need Upload access to this folder to set the drawing scale." };
  const parsed = calibrationInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid scale" };
  const { page, a, b, distance, unit } = parsed.data;
  const unitsPerPoint = calibrate(a, b, distance);
  if (!unitsPerPoint) return { ok: false, error: "Draw a longer reference line." };
  await db.$transaction(async (tx) => {
    await tx.sheetCalibration.upsert({
      where: { versionId_page: { versionId, page } },
      create: { versionId, page, unitsPerPoint, unit, setById: ctx.user.id },
      update: { unitsPerPoint, unit, setById: ctx.user.id },
    });
    await tx.auditEvent.create({
      data: { actorId: ctx.user.id, projectId, action: "sheet.calibrated", details: { document: ctx.version.document.name, version: ctx.version.number, page, distance, unit } },
    });
  });
  return { ok: true, data: { page, unitsPerPoint, unit } };
}

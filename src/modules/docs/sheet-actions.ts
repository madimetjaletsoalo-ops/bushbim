"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import type { ActionState } from "@/modules/admin/types";
import { getDocsContext } from "./access";
import { alwaysManages, levelAtLeast } from "./folder-permissions";
import { rebuildProjectSheets } from "./sheets-server";
import { regionSchema, sheetEditSchema } from "./sheets";

// Rules:
// - edit a sheet's number or title: Upload on its folder
// - create sets and add or remove sheets: Document Control Creator (and View on each sheet added)
// - delete a set: Document Control Manager
// - title block settings and re-reading all sheets: project admin or Document Control Manager

const fail = (error: string): ActionState => ({ ok: false, error });
const idSchema = z.string().min(1).max(64);
const revalidate = (projectId: string) => revalidatePath(`/projects/${projectId}/docs`, "layout");

async function sheetWithLevel(projectId: string, sheetId: unknown) {
  if (!idSchema.safeParse(sheetId).success) return null;
  const ctx = await getDocsContext(projectId);
  const sheet = await db.sheet.findFirst({
    where: { id: sheetId as string, projectId },
    include: { version: { select: { number: true, document: { select: { folderId: true, name: true } } } } },
  });
  if (!sheet) return null;
  return { ctx, sheet, level: ctx.levelOn(sheet.version.document.folderId) };
}

export async function updateSheet(projectId: string, sheetId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const found = await sheetWithLevel(projectId, sheetId);
  if (!found || !levelAtLeast(found.level, "VIEW")) return fail("Sheet not found");
  if (!levelAtLeast(found.level, "UPLOAD")) return fail("You need Upload access to this folder to edit sheets.");
  const parsed = sheetEditSchema.safeParse({ number: form.get("number"), title: form.get("title") });
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const { ctx, sheet } = found;
  await db.$transaction(async (tx) => {
    await tx.sheet.update({ where: { id: sheet.id }, data: { ...parsed.data, edited: true } });
    await tx.auditEvent.create({
      data: { actorId: ctx.user.id, projectId, action: "sheet.edited", details: { sheetId, from: `${sheet.number} ${sheet.title}`, to: `${parsed.data.number} ${parsed.data.title}` } },
    });
  });
  revalidate(projectId);
  return { ok: true, message: "Saved" };
}

const setName = z.string().trim().min(1, "Name the set").max(80);

export async function createSet(projectId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await getDocsContext(projectId);
  if (!can(ctx.member, "DOCS", "create", ctx.grants)) return fail("You don't have permission to create sets.");
  const parsed = setName.safeParse(form.get("name"));
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  try {
    await db.$transaction(async (tx) => {
      const s = await tx.sheetSet.create({ data: { projectId, name: parsed.data } });
      await tx.auditEvent.create({ data: { actorId: ctx.user.id, projectId, action: "set.created", details: { setId: s.id, name: s.name } } });
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return fail("A set with this name already exists.");
    throw e;
  }
  revalidate(projectId);
  return { ok: true, message: `Created set ${parsed.data}` };
}

export async function deleteSet(projectId: string, setId: string) {
  const ctx = await getDocsContext(projectId);
  if (!can(ctx.member, "DOCS", "manage", ctx.grants) || !idSchema.safeParse(setId).success) return;
  const set = await db.sheetSet.findFirst({ where: { id: setId, projectId } });
  if (!set) return;
  await db.$transaction(async (tx) => {
    await tx.sheetSet.delete({ where: { id: set.id } }); // sheets stay; only the grouping goes
    await tx.auditEvent.create({ data: { actorId: ctx.user.id, projectId, action: "set.deleted", details: { name: set.name } } });
  });
  revalidate(projectId);
  redirect(`/projects/${projectId}/docs/sets`);
}

export async function addSheetsToSet(projectId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await getDocsContext(projectId);
  if (!can(ctx.member, "DOCS", "create", ctx.grants)) return fail("You don't have permission to change sets.");
  const parsed = z
    .object({ setId: idSchema, sheetIds: z.array(idSchema).min(1, "Tick at least one sheet").max(2000) })
    .safeParse({ setId: form.get("setId"), sheetIds: form.getAll("sheetIds") });
  if (!parsed.success) return fail(parsed.error.issues[0].message.includes("set") ? "Pick a set" : parsed.error.issues[0].message);
  const set = await db.sheetSet.findFirst({ where: { id: parsed.data.setId, projectId } });
  if (!set) return fail("Pick a set");
  const sheets = await db.sheet.findMany({
    where: { id: { in: parsed.data.sheetIds }, projectId },
    select: { id: true, version: { select: { document: { select: { folderId: true } } } } },
  });
  const allowed = sheets.filter((s) => levelAtLeast(ctx.levelOn(s.version.document.folderId), "VIEW"));
  if (allowed.length !== parsed.data.sheetIds.length) return fail("Some of those sheets aren't available to you.");
  await db.$transaction(async (tx) => {
    await tx.setSheet.createMany({ data: allowed.map((s) => ({ setId: set.id, sheetId: s.id })), skipDuplicates: true });
    await tx.auditEvent.create({ data: { actorId: ctx.user.id, projectId, action: "set.sheets_added", details: { set: set.name, sheets: allowed.length } } });
  });
  revalidate(projectId);
  return { ok: true, message: `Added ${allowed.length} sheet${allowed.length === 1 ? "" : "s"} to ${set.name}` };
}

export async function removeSheetFromSet(projectId: string, setId: string, sheetId: string) {
  const ctx = await getDocsContext(projectId);
  if (!can(ctx.member, "DOCS", "create", ctx.grants)) return;
  if (!idSchema.safeParse(setId).success || !idSchema.safeParse(sheetId).success) return;
  const link = await db.setSheet.findFirst({ where: { setId, sheetId, set: { projectId } }, include: { set: true, sheet: true } });
  if (!link) return;
  await db.$transaction(async (tx) => {
    await tx.setSheet.delete({ where: { setId_sheetId: { setId, sheetId } } });
    await tx.auditEvent.create({ data: { actorId: ctx.user.id, projectId, action: "set.sheet_removed", details: { set: link.set.name, sheet: link.sheet.number } } });
  });
  revalidate(projectId);
}

const pct = z.coerce.number().min(0).max(100);

export async function saveTitleBlock(projectId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await getDocsContext(projectId);
  if (!alwaysManages(ctx.member, ctx.grants)) return fail("Only project admins and Document Control managers can change this.");
  const region = (prefix: string) => {
    const v = z.object({ x: pct, y: pct, w: pct, h: pct }).safeParse({
      x: form.get(`${prefix}X`),
      y: form.get(`${prefix}Y`),
      w: form.get(`${prefix}W`),
      h: form.get(`${prefix}H`),
    });
    if (!v.success) return null;
    const r = regionSchema.safeParse({ x: v.data.x / 100, y: v.data.y / 100, w: v.data.w / 100, h: v.data.h / 100 });
    return r.success ? r.data : null;
  };
  const number = region("number");
  const title = region("title");
  if (!number || !title) return fail("Each box needs a width and height above 0 and must stay on the page (left + width ≤ 100, top + height ≤ 100).");
  await db.$transaction(async (tx) => {
    await tx.titleBlockSettings.upsert({
      where: { projectId },
      create: { projectId, numberRegion: number, titleRegion: title },
      update: { numberRegion: number, titleRegion: title },
    });
    await tx.auditEvent.create({ data: { actorId: ctx.user.id, projectId, action: "titleblock.updated", details: { number, title } } });
  });
  revalidate(projectId);
  return { ok: true, message: "Saved. Use “Re-read all sheets” to apply it to sheets already uploaded." };
}

export async function rebuildSheets(projectId: string): Promise<ActionState> {
  const ctx = await getDocsContext(projectId);
  if (!alwaysManages(ctx.member, ctx.grants)) return fail("Only project admins and Document Control managers can do this.");
  const count = await rebuildProjectSheets(projectId);
  await db.auditEvent.create({ data: { actorId: ctx.user.id, projectId, action: "sheets.rebuilt", details: { sheets: count } } });
  revalidate(projectId);
  return { ok: true, message: `Re-read ${count} sheet${count === 1 ? "" : "s"}. Sheets edited by hand were left as they were.` };
}

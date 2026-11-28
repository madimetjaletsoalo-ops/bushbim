"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import type { ActionState } from "@/modules/admin/types";
import {
  LIMITS,
  canEditLabourRow,
  coordinatesSchema,
  dateToDay,
  dayToDate,
  equipmentSchema,
  isFutureDay,
  labourSchema,
  logTextSchema,
  moveInList,
  normaliseItemAnswer,
  parseDay,
  publishBlockers,
  templateItemSchema,
  visitorSchema,
  weatherSchema,
} from "./logic";
import { fetchWeather, getDailyLogsContext, type DailyLogsContext } from "./server";

// Access rules live in logic.ts (dailyLogAccess). Every action re-checks them, validates its
// input with Zod and writes an AuditEvent.

const fail = (error: string): ActionState => ({ ok: false, error });
const ok = (message: string): ActionState => ({ ok: true, message });
const str = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
};
const idSchema = z.string().min(1).max(64);
const unique = (e: unknown) => typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "P2002";
const refresh = (projectId: string) => {
  revalidatePath(`/projects/${projectId}/daily-logs`, "layout");
};
const audit = (ctx: DailyLogsContext, action: string, details: Prisma.InputJsonValue) =>
  db.auditEvent.create({ data: { actorId: ctx.user.id, projectId: ctx.project.id, action, details } });
const first = (e: z.ZodError) => e.issues[0]?.message ?? "Invalid input";

const NOT_DRAFT = "This log is published. Reopen it to make changes.";

async function loadLog(ctx: DailyLogsContext, logId: string) {
  if (!idSchema.safeParse(logId).success) return null;
  const log = await db.dailyLog.findFirst({ where: { id: logId, projectId: ctx.project.id } });
  return log ? { log, access: ctx.accessFor(log), day: dateToDay(log.date) } : null;
}

/** The log for editing its general sections (Creators, draft only). */
async function editableLog(projectId: string, logId: string) {
  const ctx = await getDailyLogsContext(projectId);
  const found = await loadLog(ctx, logId);
  if (!found?.access.see) return { error: "Daily log not found." } as const;
  if (!found.access.edit) return { error: found.log.status === "PUBLISHED" ? NOT_DRAFT : "Editing daily logs needs Daily Logs Creator access." } as const;
  return { ctx, ...found };
}

// ---------- logs ----------

/** Starts the log for a day (today or earlier): copies the template items and fetches the weather. */
export async function startLog(projectId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await getDailyLogsContext(projectId);
  if (!ctx.canCreate) return fail("Starting a daily log needs Daily Logs Creator access.");
  const day = parseDay(str(form, "date"));
  if (!day) return fail("Choose a date.");
  if (isFutureDay(day, ctx.project.timezone)) return fail("Daily logs can't be started for a future day.");
  const date = dayToDate(day);
  const existing = await db.dailyLog.findUnique({ where: { projectId_date: { projectId, date } }, select: { id: true } });
  if (!existing) {
    const [template, weather] = await Promise.all([
      db.dailyLogTemplateItem.findMany({ where: { projectId }, orderBy: { order: "asc" } }),
      fetchWeather(ctx.project, day),
    ]);
    try {
      await db.$transaction(async (tx) => {
        const log = await tx.dailyLog.create({
          data: { projectId, date, createdById: ctx.user.id, ...(weather ? { ...weather, weatherSource: "AUTO" as const } : {}) },
        });
        if (template.length)
          await tx.dailyLogItem.createMany({ data: template.map((t, n) => ({ logId: log.id, label: t.label, kind: t.kind, required: t.required, order: n })) });
        await tx.auditEvent.create({
          data: { actorId: ctx.user.id, projectId, action: "daily_log.created", details: { logId: log.id, date: day, weather: weather ? "auto" : "none", items: template.length } },
        });
      });
    } catch (e) {
      // two people started the same day at once: open the one that won
      if (!unique(e)) throw e;
    }
    refresh(projectId);
  }
  redirect(`/projects/${projectId}/daily-logs/${day}`);
}

export async function updateWeather(projectId: string, logId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const found = await editableLog(projectId, logId);
  if ("error" in found) return fail(found.error!);
  const { ctx, log, day } = found;
  const parsed = weatherSchema.safeParse({
    conditions: str(form, "conditions"),
    tempMin: str(form, "tempMin"),
    tempMax: str(form, "tempMax"),
    precipitation: str(form, "precipitation"),
    windMax: str(form, "windMax"),
    weatherNote: str(form, "weatherNote"),
  });
  if (!parsed.success) return fail(first(parsed.error));
  const w = parsed.data;
  const changed = (Object.keys(w) as (keyof typeof w)[]).filter((k) => w[k] !== log[k]);
  if (!changed.length) return ok("No changes.");
  // editing an automatic reading (not only the note) makes it a manual one
  const source = changed.some((k) => k !== "weatherNote") ? "MANUAL" : log.weatherSource;
  await db.$transaction([
    db.dailyLog.update({ where: { id: log.id }, data: { ...w, weatherSource: source, ...(changed.includes("conditions") ? { weatherCode: null } : {}) } }),
    db.auditEvent.create({ data: { actorId: ctx.user.id, projectId, action: "daily_log.weather_updated", details: { logId: log.id, date: day, fields: changed } } }),
  ]);
  refresh(projectId);
  return ok("Weather saved.");
}

/** Replaces the weather with Open-Meteo's reading for the day. */
export async function refreshWeather(projectId: string, logId: string): Promise<ActionState> {
  const found = await editableLog(projectId, logId);
  if ("error" in found) return fail(found.error!);
  const { ctx, log, day } = found;
  if (ctx.project.latitude === null || ctx.project.longitude === null)
    return fail("Set the project's coordinates in Daily Logs settings to fetch the weather automatically.");
  const weather = await fetchWeather(ctx.project, day);
  if (!weather) return fail("Couldn't reach the weather service. Enter the weather by hand or try again later.");
  await db.$transaction([
    db.dailyLog.update({ where: { id: log.id }, data: { ...weather, weatherSource: "AUTO" } }),
    db.auditEvent.create({ data: { actorId: ctx.user.id, projectId, action: "daily_log.weather_fetched", details: { logId: log.id, date: day, conditions: weather.conditions } } }),
  ]);
  refresh(projectId);
  return ok("Weather updated from Open-Meteo.");
}

export async function updateLogText(projectId: string, logId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const found = await editableLog(projectId, logId);
  if ("error" in found) return fail(found.error!);
  const { ctx, log, day } = found;
  const parsed = logTextSchema.safeParse({ workSummary: str(form, "workSummary"), notes: str(form, "notes") });
  if (!parsed.success) return fail(first(parsed.error));
  const changed = (["workSummary", "notes"] as const).filter((k) => parsed.data[k] !== log[k]);
  if (!changed.length) return ok("No changes.");
  await db.$transaction([
    db.dailyLog.update({ where: { id: log.id }, data: parsed.data }),
    db.auditEvent.create({ data: { actorId: ctx.user.id, projectId, action: "daily_log.updated", details: { logId: log.id, date: day, fields: changed } } }),
  ]);
  refresh(projectId);
  return ok("Saved.");
}

/** Publishing locks the log. Blocked while the mandatory work log or required items are missing. */
export async function publishLog(projectId: string, logId: string): Promise<ActionState> {
  const ctx = await getDailyLogsContext(projectId);
  const found = await loadLog(ctx, logId);
  if (!found?.access.see) return fail("Daily log not found.");
  if (!found.access.publish) return fail(found.log.status === "PUBLISHED" ? "This log is already published." : "Publishing daily logs needs Daily Logs Creator access.");
  const { log, day } = found;
  const [labour, items] = await Promise.all([
    db.dailyLogLabour.findMany({ where: { logId: log.id }, select: { work: true } }),
    db.dailyLogItem.findMany({ where: { logId: log.id }, select: { label: true, required: true, value: true } }),
  ]);
  const blockers = publishBlockers({ workSummary: log.workSummary, labour, items }, ctx.settings);
  if (blockers.length) return { ok: false, error: "This log can't be published yet.", details: blockers.slice(0, 10) };
  const done = await db.dailyLog.updateMany({ where: { id: log.id, status: "DRAFT" }, data: { status: "PUBLISHED", publishedAt: new Date(), publishedById: ctx.user.id } });
  if (!done.count) return fail("This log is already published.");
  await audit(ctx, "daily_log.published", { logId: log.id, date: day, labourRows: labour.length });
  refresh(projectId);
  return ok("Log published and locked.");
}

/** Reopens a published log: Creators within 24 h of publishing, Daily Logs Managers at any time. */
export async function reopenLog(projectId: string, logId: string): Promise<ActionState> {
  const ctx = await getDailyLogsContext(projectId);
  const found = await loadLog(ctx, logId);
  if (!found?.access.see) return fail("Daily log not found.");
  if (!found.access.reopen)
    return fail(found.access.reopenNeedsManager ? "This log was published more than 24 hours ago. Only a Daily Logs Manager can reopen it." : "You can't reopen this log.");
  const { log, day } = found;
  await db.$transaction([
    db.dailyLog.update({ where: { id: log.id }, data: { status: "DRAFT", publishedAt: null, publishedById: null } }),
    db.auditEvent.create({
      data: { actorId: ctx.user.id, projectId, action: "daily_log.reopened", details: { logId: log.id, date: day, publishedAt: log.publishedAt?.toISOString() ?? null } },
    }),
  ]);
  refresh(projectId);
  return ok("Log reopened.");
}

/** Deletes a log with its rows and photos (Daily Logs Managers). */
export async function deleteLog(projectId: string, logId: string) {
  const ctx = await getDailyLogsContext(projectId);
  const found = await loadLog(ctx, logId);
  if (!found?.access.delete) return;
  const { log, day } = found;
  const photos = await db.photo.findMany({ where: { dailyLogId: log.id }, select: { storageKey: true, thumbKey: true } });
  await db.$transaction([
    db.dailyLog.delete({ where: { id: log.id } }),
    db.auditEvent.create({ data: { actorId: ctx.user.id, projectId, action: "daily_log.deleted", details: { logId: log.id, date: day, photos: photos.length } } }),
  ]);
  if (photos.length) {
    try {
      await getStorage().remove(photos.flatMap((p) => [p.storageKey, p.thumbKey]));
    } catch (e) {
      console.error("daily-logs: failed to remove stored photos", e);
    }
  }
  refresh(projectId);
  redirect(`/projects/${projectId}/daily-logs`);
}

// ---------- labour and work (subcontractors contribute their own company's rows) ----------

function readLabour(ctx: DailyLogsContext, form: FormData) {
  const creator = ctx.canCreate;
  // contributors always write for their own company
  const raw = { companyId: creator ? str(form, "companyId") : (ctx.ownCompany?.id ?? ""), crew: str(form, "crew"), trade: str(form, "trade"), headcount: str(form, "headcount"), hours: str(form, "hours"), work: str(form, "work") };
  const parsed = labourSchema.safeParse(raw);
  if (!parsed.success) return { error: first(parsed.error) };
  const v = parsed.data;
  const company = v.companyId ? ctx.companies.find((c) => c.id === v.companyId) : null;
  if (v.companyId && !company) return { error: "Choose a company from the list." };
  if (!company && !v.crew) return { error: "Choose a company or name the crew." };
  return { data: { companyId: company?.id ?? null, companyName: company?.name ?? v.crew!, trade: v.trade ?? company?.trade ?? null, headcount: v.headcount, hours: v.hours, work: v.work } };
}

export async function addLabour(projectId: string, logId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await getDailyLogsContext(projectId);
  const found = await loadLog(ctx, logId);
  if (!found?.access.see) return fail("Daily log not found.");
  if (!found.access.contribute)
    return fail(found.log.status === "PUBLISHED" ? NOT_DRAFT : "Adding labour needs Daily Logs Creator access, or membership of a company on this project.");
  const row = readLabour(ctx, form);
  if ("error" in row) return fail(row.error!);
  if ((await db.dailyLogLabour.count({ where: { logId } })) >= LIMITS.rowsPerSection) return fail(`A log can have up to ${LIMITS.rowsPerSection} labour rows.`);
  const created = await db.dailyLogLabour.create({ data: { logId, ...row.data, createdById: ctx.user.id } });
  await audit(ctx, "daily_log.labour_added", { logId, date: found.day, rowId: created.id, company: created.companyName, headcount: created.headcount, hours: created.hours });
  refresh(projectId);
  return ok(`Added ${created.companyName}.`);
}

async function labourRow(ctx: DailyLogsContext, logId: string, rowId: string) {
  const found = await loadLog(ctx, logId);
  if (!found?.access.see || !idSchema.safeParse(rowId).success) return null;
  const row = await db.dailyLogLabour.findFirst({ where: { id: rowId, logId } });
  return row ? { ...found, row, canEdit: canEditLabourRow(found.access, ctx.level, ctx.member, row) } : null;
}

export async function updateLabour(projectId: string, logId: string, rowId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await getDailyLogsContext(projectId);
  const found = await labourRow(ctx, logId, rowId);
  if (!found) return fail("Labour row not found.");
  if (!found.canEdit) return fail(found.log.status === "PUBLISHED" ? NOT_DRAFT : "You can edit only your own company's labour.");
  const row = readLabour(ctx, form);
  if ("error" in row) return fail(row.error!);
  const before = found.row;
  const changed = (Object.keys(row.data) as (keyof typeof row.data)[]).filter((k) => row.data[k] !== before[k]);
  if (!changed.length) return ok("No changes.");
  await db.$transaction([
    db.dailyLogLabour.update({ where: { id: rowId }, data: row.data }),
    db.auditEvent.create({ data: { actorId: ctx.user.id, projectId, action: "daily_log.labour_updated", details: { logId, date: found.day, rowId, company: row.data.companyName, fields: changed } } }),
  ]);
  refresh(projectId);
  return ok("Saved.");
}

export async function deleteLabour(projectId: string, logId: string, rowId: string) {
  const ctx = await getDailyLogsContext(projectId);
  const found = await labourRow(ctx, logId, rowId);
  if (!found?.canEdit) return;
  await db.$transaction([
    db.dailyLogLabour.delete({ where: { id: rowId } }),
    db.auditEvent.create({ data: { actorId: ctx.user.id, projectId, action: "daily_log.labour_deleted", details: { logId, date: found.day, rowId, company: found.row.companyName } } }),
  ]);
  refresh(projectId);
}

// ---------- equipment and visitors (Creators) ----------

export async function addEquipment(projectId: string, logId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const found = await editableLog(projectId, logId);
  if ("error" in found) return fail(found.error!);
  const parsed = equipmentSchema.safeParse({ name: str(form, "name"), quantity: str(form, "quantity") || "1", hours: str(form, "hours"), notes: str(form, "notes") });
  if (!parsed.success) return fail(first(parsed.error));
  if ((await db.dailyLogEquipment.count({ where: { logId } })) >= LIMITS.rowsPerSection) return fail(`A log can have up to ${LIMITS.rowsPerSection} equipment rows.`);
  const e = await db.dailyLogEquipment.create({ data: { logId, ...parsed.data } });
  await audit(found.ctx, "daily_log.equipment_added", { logId, date: found.day, rowId: e.id, name: e.name, quantity: e.quantity });
  refresh(projectId);
  return ok(`Added ${e.name}.`);
}

export async function deleteEquipment(projectId: string, logId: string, rowId: string) {
  const found = await editableLog(projectId, logId);
  if ("error" in found || !idSchema.safeParse(rowId).success) return;
  const row = await db.dailyLogEquipment.findFirst({ where: { id: rowId, logId } });
  if (!row) return;
  await db.$transaction([
    db.dailyLogEquipment.delete({ where: { id: rowId } }),
    db.auditEvent.create({ data: { actorId: found.ctx.user.id, projectId, action: "daily_log.equipment_deleted", details: { logId, date: found.day, rowId, name: row.name } } }),
  ]);
  refresh(projectId);
}

export async function addVisitor(projectId: string, logId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const found = await editableLog(projectId, logId);
  if ("error" in found) return fail(found.error!);
  const parsed = visitorSchema.safeParse({ name: str(form, "name"), organisation: str(form, "organisation"), purpose: str(form, "purpose"), arrivedAt: str(form, "arrivedAt"), leftAt: str(form, "leftAt") });
  if (!parsed.success) return fail(first(parsed.error));
  if ((await db.dailyLogVisitor.count({ where: { logId } })) >= LIMITS.rowsPerSection) return fail(`A log can have up to ${LIMITS.rowsPerSection} visitors.`);
  const v = await db.dailyLogVisitor.create({ data: { logId, ...parsed.data } });
  await audit(found.ctx, "daily_log.visitor_added", { logId, date: found.day, rowId: v.id, name: v.name, organisation: v.organisation });
  refresh(projectId);
  return ok(`Added ${v.name}.`);
}

export async function deleteVisitor(projectId: string, logId: string, rowId: string) {
  const found = await editableLog(projectId, logId);
  if ("error" in found || !idSchema.safeParse(rowId).success) return;
  const row = await db.dailyLogVisitor.findFirst({ where: { id: rowId, logId } });
  if (!row) return;
  await db.$transaction([
    db.dailyLogVisitor.delete({ where: { id: rowId } }),
    db.auditEvent.create({ data: { actorId: found.ctx.user.id, projectId, action: "daily_log.visitor_deleted", details: { logId, date: found.day, rowId, name: row.name } } }),
  ]);
  refresh(projectId);
}

// ---------- the log's custom checklist items ----------

export async function answerLogItem(projectId: string, logId: string, itemId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const found = await editableLog(projectId, logId);
  if ("error" in found) return fail(found.error!);
  if (!idSchema.safeParse(itemId).success) return fail("Item not found.");
  const item = await db.dailyLogItem.findFirst({ where: { id: itemId, logId } });
  if (!item) return fail("Item not found.");
  const answer = normaliseItemAnswer(item.kind, str(form, "value"));
  if ("error" in answer) return fail(answer.error);
  if (answer.value === item.value) return ok("No changes.");
  await db.$transaction([
    db.dailyLogItem.update({ where: { id: item.id }, data: { value: answer.value, answeredById: answer.value ? found.ctx.user.id : null, answeredAt: answer.value ? new Date() : null } }),
    db.auditEvent.create({
      data: { actorId: found.ctx.user.id, projectId, action: answer.value ? "daily_log.item_answered" : "daily_log.item_cleared", details: { logId, date: found.day, itemId, item: item.label, value: answer.value } },
    }),
  ]);
  refresh(projectId);
  return ok(answer.value ? "Saved." : "Answer cleared.");
}

// ---------- settings and the log template (Daily Logs Managers) ----------

const NOT_MANAGER = "Daily Logs settings need Daily Logs Manager access.";

export async function updateDailyLogSettings(projectId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await getDailyLogsContext(projectId);
  if (!ctx.canManage) return fail(NOT_MANAGER);
  const coords = coordinatesSchema.safeParse({ latitude: str(form, "latitude"), longitude: str(form, "longitude") });
  if (!coords.success) return fail(first(coords.error));
  const workLogRequired = form.get("workLogRequired") === "on";
  const { latitude, longitude } = coords.data;
  await db.$transaction([
    db.project.update({ where: { id: projectId }, data: { latitude, longitude } }),
    db.dailyLogSettings.upsert({ where: { projectId }, create: { projectId, workLogRequired }, update: { workLogRequired } }),
    db.auditEvent.create({ data: { actorId: ctx.user.id, projectId, action: "daily_log.settings_updated", details: { latitude, longitude, workLogRequired } } }),
  ]);
  refresh(projectId);
  return ok("Settings saved.");
}

export async function addTemplateItem(projectId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await getDailyLogsContext(projectId);
  if (!ctx.canManage) return fail(NOT_MANAGER);
  const parsed = templateItemSchema.safeParse({ label: str(form, "label"), kind: str(form, "kind"), required: form.get("required") === "on" });
  if (!parsed.success) return fail(first(parsed.error));
  const items = await db.dailyLogTemplateItem.findMany({ where: { projectId }, select: { order: true } });
  if (items.length >= LIMITS.templateItems) return fail(`The log template can have up to ${LIMITS.templateItems} items.`);
  const order = items.reduce((m, i) => Math.max(m, i.order), -1) + 1;
  const item = await db.dailyLogTemplateItem.create({ data: { projectId, ...parsed.data, order } });
  await audit(ctx, "daily_log.template_item_added", { itemId: item.id, label: item.label, kind: item.kind, required: item.required });
  refresh(projectId);
  return ok("Item added. New logs will include it.");
}

export async function deleteTemplateItem(projectId: string, itemId: string) {
  const ctx = await getDailyLogsContext(projectId);
  if (!ctx.canManage || !idSchema.safeParse(itemId).success) return;
  const item = await db.dailyLogTemplateItem.findFirst({ where: { id: itemId, projectId } });
  if (!item) return;
  await db.$transaction([
    db.dailyLogTemplateItem.delete({ where: { id: item.id } }),
    db.auditEvent.create({ data: { actorId: ctx.user.id, projectId, action: "daily_log.template_item_deleted", details: { itemId, label: item.label } } }),
  ]);
  refresh(projectId);
}

export async function moveTemplateItem(projectId: string, itemId: string, dir: "up" | "down") {
  const ctx = await getDailyLogsContext(projectId);
  if (!ctx.canManage || (dir !== "up" && dir !== "down")) return;
  const items = await db.dailyLogTemplateItem.findMany({ where: { projectId }, orderBy: { order: "asc" }, select: { id: true } });
  const order = moveInList(items.map((i) => i.id), itemId, dir);
  if (!order) return;
  await db.$transaction([
    ...order.map((id, n) => db.dailyLogTemplateItem.update({ where: { id }, data: { order: n } })),
    db.auditEvent.create({ data: { actorId: ctx.user.id, projectId, action: "daily_log.template_item_moved", details: { itemId, dir } } }),
  ]);
  refresh(projectId);
}

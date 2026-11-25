import { expect, test, type Browser, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { jpegSize } from "../../src/modules/issues/media";

async function signUpWithProject(page: Page, stamp: number, project: string) {
  await page.goto("/signup");
  await page.getByLabel("Organisation").fill(`Kruger Lodges ${stamp}`);
  await page.getByLabel("Your name").fill("Naledi Manager");
  await page.getByLabel("Work email").fill(`chk${stamp}@kruger.test`);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Name").fill(project);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { name: "Members" })).toBeVisible();
}

/** Adds a member with Document Control, Issues and Checklists (Viewer on each) and returns a signed-in page for them. */
async function inviteAndJoin(admin: Page, browser: Browser, email: string, name: string) {
  const add = admin.getByTestId("add-member-form");
  await add.getByLabel("Email").fill(email);
  await add.getByLabel("Name").fill(name);
  await add.getByLabel("Checklists").check();
  await add.getByRole("button", { name: "Add member" }).click();
  await expect(add.getByRole("status")).toContainText(`Added ${email}`);
  await admin.getByTestId("members-table").getByRole("row", { name: new RegExp(name) }).getByRole("button", { name: "Copy invite link" }).click();
  const link = await admin.evaluate(() => navigator.clipboard.readText());
  const page = await (await browser.newContext()).newPage();
  await page.goto(link);
  await page.getByLabel("Password").fill("password456");
  await page.getByRole("button", { name: "Join project" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  return page;
}

/** A large PNG drawn in the browser, like an uncompressed phone photo. */
async function bigPng(page: Page, w: number, h: number) {
  const b64 = await page.evaluate(
    async ([w, h]) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const g = c.getContext("2d")!;
      g.fillStyle = "#2e6b4f";
      g.fillRect(0, 0, w, h);
      const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), "image/png"));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let s = "";
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(s);
    },
    [w, h],
  );
  return Buffer.from(b64, "base64");
}

const item = (page: Page, label: string) => page.getByTestId("checklist-item").filter({ hasText: label });

test("checklists: starter templates, template builder, assign, answer every kind, complete, raise an issue and PDF", async ({ page, browser }) => {
  const stamp = Date.now();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await signUpWithProject(page, stamp, "Timbavati Boma");
  const sipho = await inviteAndJoin(page, browser, `sipho${stamp}@kruger.test`, "Sipho Contractor");

  // a location to link the checklist to (the project location tree lives under Issues › Settings)
  await page.getByRole("link", { name: "Issues", exact: true }).click();
  await page.getByRole("navigation", { name: "Issues" }).getByRole("link", { name: "Settings" }).click();
  const loc = page.getByTestId("add-location-form");
  await loc.getByLabel("Location name").fill("Main boma");
  await loc.getByRole("button", { name: "Add location" }).click();
  await expect(loc.getByRole("status")).toContainText("Added Main boma");

  // the three starter templates are there the first time
  await page.getByRole("navigation", { name: "Modules" }).getByRole("link", { name: "Checklists" }).click();
  await expect(page.getByRole("heading", { name: "Checklists" })).toBeVisible();
  await page.getByRole("navigation", { name: "Checklists" }).getByRole("link", { name: "Templates" }).click();
  const rows = page.getByTestId("template-row");
  await expect(rows).toHaveCount(3);
  await expect(rows.filter({ hasText: "Villa handover snag list (luxury finishes)" })).toBeVisible();
  await expect(rows.filter({ hasText: "Thatch roof inspection" })).toBeVisible();
  await expect(rows.filter({ hasText: "Pool commissioning" })).toBeVisible();

  // build a template: sections and items of every kind
  const create = page.getByTestId("new-template-form");
  await create.getByLabel("Template name").fill("Boma kitchen handover");
  await create.getByRole("button", { name: "Create template" }).click();
  await expect(page.getByTestId("template-name")).toHaveText("Boma kitchen handover");
  const first = page.getByTestId("template-section").first();
  await first.getByLabel("Section title General").fill("Kitchen");
  await first.getByRole("button", { name: "Rename" }).click();
  await expect(first.getByRole("status")).toContainText("Section renamed");
  const addItem = async (section: number, label: string, kind: string, required = false) => {
    const form = page.getByTestId("template-section").nth(section).getByTestId("add-item-form");
    await form.getByLabel("New item").fill(label);
    await form.getByLabel("Answer").selectOption(kind);
    if (required) await form.getByLabel("Required").check();
    await form.getByRole("button", { name: "Add item" }).click();
    await expect(form.getByRole("status")).toContainText("Item added");
  };
  await addItem(0, "Extractor fan working", "YES_NO", true);
  await addItem(0, "Gas certificate number", "TEXT", true);
  await addItem(0, "Walk-in fridge temperature (°C)", "NUMBER", true);
  await addItem(0, "Throwaway item", "TEXT");
  await addItem(0, "Photo of the pass", "PHOTO", true);
  await page.getByTestId("template-item").filter({ has: page.getByLabel("Item Throwaway item") }).getByRole("button", { name: "Delete Throwaway item" }).click();
  await expect(page.getByLabel("Item Throwaway item")).toHaveCount(0);
  const addSection = page.getByTestId("add-section-form");
  await addSection.getByLabel("New section").fill("Sign-off");
  await addSection.getByRole("button", { name: "Add section" }).click();
  await expect(page.getByTestId("template-section")).toHaveCount(2);
  await addItem(1, "Handover date", "DATE", true);
  await addItem(1, "Chef's signature", "SIGNATURE", true);
  // reorder: the photo item moves above the number item
  await page.getByRole("button", { name: "Move Photo of the pass up" }).click();
  await expect(page.getByTestId("template-section").first().getByTestId("template-item").nth(2).locator("input[name=label]")).toHaveValue("Photo of the pass");

  // create a checklist from it, assigned to Sipho at the main boma
  await page.getByRole("link", { name: "Use template" }).click();
  const form = page.getByTestId("checklist-form");
  await expect(form.getByLabel("Template")).toHaveValue(/.+/);
  await form.getByLabel("Title").fill("Main boma kitchen");
  await form.getByLabel("Assigned to").selectOption({ label: "Sipho Contractor" });
  await form.getByLabel("Location").selectOption({ label: "Main boma" });
  await form.getByRole("button", { name: "Create checklist" }).click();
  await expect(page.getByRole("heading", { name: "Main boma kitchen" })).toBeVisible();
  await expect(page.getByTestId("checklist-status")).toHaveText("Not started");
  await expect(page.getByTestId("checklist-assignee")).toHaveText("Sipho Contractor");
  await expect(page.getByTestId("checklist-location")).toHaveText("Main boma");
  await expect(page.getByTestId("checklist-progress")).toContainText("0 of 6 answered");
  const checklistUrl = page.url();

  // it can't be completed with required items left
  await page.getByTestId("complete-form").getByRole("button", { name: "Complete checklist" }).click();
  await expect(page.getByTestId("complete-form").getByRole("alert")).toContainText("Answer the required items first (6 left)");

  // Sipho (Checklists Viewer, assignee) finds it under "Assigned to me" and fills it in
  await sipho.getByRole("link", { name: /Timbavati Boma/ }).click();
  await sipho.getByRole("navigation", { name: "Modules" }).getByRole("link", { name: "Checklists" }).click();
  await expect(sipho.getByRole("navigation", { name: "Checklists" }).getByRole("link", { name: "Templates" })).toHaveCount(0);
  await sipho.getByRole("link", { name: "Assigned to me" }).click();
  await expect(sipho.getByTestId("checklist-row")).toHaveCount(1);
  await sipho.getByTestId("checklist-row").getByRole("link", { name: "Main boma kitchen" }).click();
  await expect(sipho.getByTestId("details-form")).toHaveCount(0);

  const fan = item(sipho, "Extractor fan working");
  await fan.getByRole("button", { name: "No", exact: true }).click();
  await expect(fan.getByRole("button", { name: "No", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(sipho.getByTestId("checklist-status")).toHaveText("In progress");
  await fan.getByLabel("Note: Extractor fan working").fill("Motor hums but the fan doesn't spin");
  await fan.getByRole("button", { name: "Save note" }).click();
  await expect(fan.getByTestId("note-form").getByRole("status")).toContainText("Saved");
  // Sipho is only an Issues Viewer, so he can't raise the issue himself
  await expect(fan.getByTestId("raise-issue-form")).toHaveCount(0);

  const gas = item(sipho, "Gas certificate number");
  await gas.getByLabel("Answer: Gas certificate number").fill("LPG-2026-0193");
  await gas.getByRole("button", { name: "Save" }).click();
  await expect(gas.getByRole("status")).toContainText("Saved");

  const fridge = item(sipho, "Walk-in fridge temperature");
  await fridge.getByLabel(/Answer: Walk-in fridge/).fill("three");
  await fridge.getByRole("button", { name: "Save" }).click();
  await expect(fridge.getByRole("alert")).toContainText("Enter a number");
  await fridge.getByLabel(/Answer: Walk-in fridge/).fill("3,5");
  await fridge.getByRole("button", { name: "Save" }).click();
  await expect(fridge.getByRole("status")).toContainText("Saved");
  await expect(fridge.getByLabel(/Answer: Walk-in fridge/)).toHaveValue("3.5");

  // a 2400 px photo is compressed on the device before upload
  const photo = item(sipho, "Photo of the pass");
  await photo.getByLabel("Choose photos").setInputFiles([{ name: "pass.png", mimeType: "image/png", buffer: await bigPng(sipho, 2400, 1800) }]);
  await expect(photo.getByTestId("photo-upload-list")).toContainText("Saved, 1600×1200");
  await expect(photo.getByTestId("item-photos").locator("li")).toHaveCount(1);
  const href = await photo.getByTestId("item-photos").locator("a").first().getAttribute("href");
  const full = await sipho.request.get(href!);
  expect(jpegSize(new Uint8Array(await full.body()))).toEqual({ width: 1600, height: 1200 });

  const date = item(sipho, "Handover date");
  await date.getByLabel("Answer: Handover date").fill("2026-11-24");
  await date.getByRole("button", { name: "Save" }).click();
  await expect(date.getByRole("status")).toContainText("Saved");

  // draw a signature
  const sig = item(sipho, "Chef's signature");
  const pad = sig.getByTestId("signature-pad");
  const box = (await pad.boundingBox())!;
  await sipho.mouse.move(box.x + 20, box.y + box.height / 2);
  await sipho.mouse.down();
  for (let i = 1; i <= 10; i++) await sipho.mouse.move(box.x + 20 + i * 25, box.y + box.height / 2 + (i % 2 ? -20 : 20));
  await sipho.mouse.up();
  await sig.getByRole("button", { name: "Save signature" }).click();
  await expect(sig.getByTestId("signature-image")).toBeVisible();
  await expect(sipho.getByTestId("checklist-progress")).toContainText("6 of 6 answered · 1 failed");

  // completing records who and when, and locks the answers
  await sipho.getByTestId("complete-form").getByRole("button", { name: "Complete checklist" }).click();
  await expect(sipho.getByTestId("checklist-status")).toHaveText("Completed");
  await expect(sipho.getByTestId("completed-note")).toContainText("Completed by Sipho Contractor");
  await expect(sipho.getByTestId("yes-no-form")).toHaveCount(0);
  await expect(sipho.getByTestId("complete-form")).toHaveCount(0);
  await expect(sipho.getByRole("button", { name: "Reopen" })).toHaveCount(0);

  // the manager raises an issue from the failed item with one click
  await page.goto(checklistUrl);
  const mFan = item(page, "Extractor fan working");
  await mFan.getByRole("button", { name: "Raise issue" }).click();
  await expect(mFan.getByTestId("raised-issue")).toContainText("#1");
  await expect(mFan.getByTestId("raise-issue-form")).toHaveCount(0);
  await mFan.getByTestId("raised-issue").getByRole("link", { name: "#1" }).click();
  await expect(page.getByRole("heading", { name: /#1 Extractor fan working \(CL-1\)/ })).toBeVisible();
  await expect(page.getByTestId("from-checklist")).toHaveText("From checklist CL-1");
  await expect(page.getByTestId("edit-issue-form").getByLabel("Description")).toHaveValue(/Motor hums but the fan doesn't spin/);
  await expect(page.getByTestId("edit-issue-form").getByLabel("Location")).toHaveValue(/.+/);
  await expect(page.getByTestId("edit-issue-form").getByLabel("Assigned to")).toHaveValue(/^USER:/);

  // the result as a PDF
  const pdf = await page.request.get(`${new URL(checklistUrl).pathname.replace("/projects/", "/api/projects/")}/pdf`);
  expect(pdf.ok()).toBe(true);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  const doc = await PDFDocument.load(await pdf.body());
  expect(doc.getTitle()).toBe("CL-1: Main boma kitchen");
  expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);

  // the photo shows in the project gallery under "On checklists"
  await page.getByRole("navigation", { name: "Issues" }).getByRole("link", { name: "Photos" }).click();
  await page.getByRole("link", { name: "On checklists" }).click();
  await expect(page.getByTestId("photo-grid").getByTestId("photo")).toHaveCount(1);
  await expect(page.getByTestId("photo-checklist")).toContainText("CL-1 Main boma kitchen");

  // the manager reopens it; answers can change again
  await page.goto(checklistUrl);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Reopen" }).click();
  await expect(page.getByTestId("checklist-status")).toHaveText("In progress");
  await expect(page.getByTestId("yes-no-form").first()).toBeVisible();

  // the list shows status and progress; archived templates can't be used for new checklists
  await page.getByRole("navigation", { name: "Checklists" }).getByRole("link", { name: "All checklists" }).click();
  const row = page.getByTestId("checklist-row");
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId("checklist-progress")).toContainText("6/6");
  await expect(row.getByTestId("checklist-progress")).toContainText("1 failed");
  await page.getByRole("navigation", { name: "Checklists" }).getByRole("link", { name: "Templates" }).click();
  await page.getByTestId("template-row").filter({ hasText: "Boma kitchen handover" }).getByRole("button", { name: "Archive" }).click();
  await expect(page.getByTestId("template-row").filter({ hasText: "Boma kitchen handover" })).toContainText("Archived");
  await page.getByRole("navigation", { name: "Checklists" }).getByRole("link", { name: "New checklist" }).click();
  const options = page.getByTestId("checklist-form").getByLabel("Template").locator("option");
  await expect(options).toHaveCount(4); // placeholder + the three starters
  await expect(options.filter({ hasText: "Boma kitchen handover" })).toHaveCount(0);

  // a starter template makes a full checklist
  await page.getByTestId("checklist-form").getByLabel("Template").selectOption({ label: "Thatch roof inspection (15 items)" });
  await page.getByTestId("checklist-form").getByRole("button", { name: "Create checklist" }).click();
  await expect(page.getByRole("heading", { name: "Thatch roof inspection" })).toBeVisible();
  await expect(page.getByTestId("checklist-section")).toHaveCount(4);
});

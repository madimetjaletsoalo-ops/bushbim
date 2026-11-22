import { expect, test, type Locator, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";

/** A two-page 600×400 pt PDF with a label on each page. */
async function samplePdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const label of ["SHEET ONE", "SHEET TWO"]) doc.addPage([600, 400]).drawText(label, { x: 40, y: 360, size: 20, font });
  return Buffer.from(await doc.save());
}

/** Page units → screen position on the markup layer. */
async function at(layer: Locator, x: number, y: number) {
  const box = (await layer.boundingBox())!;
  const z = box.width / 600;
  return { x: box.x + x * z, y: box.y + y * z };
}
async function drag(page: Page, layer: Locator, from: [number, number], to: [number, number]) {
  const a = await at(layer, ...from);
  const b = await at(layer, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
}
async function click(page: Page, layer: Locator, p: [number, number]) {
  const a = await at(layer, ...p);
  await page.mouse.click(a.x, a.y);
}

test("viewer: pages, zoom, markups, private vs published, scale, measuring and PDF export", async ({ page, browser }) => {
  const stamp = Date.now();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/signup");
  await page.getByLabel("Organisation").fill(`Sossus Dune Lodges ${stamp}`);
  await page.getByLabel("Your name").fill("Nadia Architect");
  await page.getByLabel("Work email").fill(`view${stamp}@dune.test`);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Name").fill("Sossusvlei Desert Suites");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { name: "Members" })).toBeVisible();

  // a Viewer teammate, added now so they can check visibility later
  const add = page.getByTestId("add-member-form");
  await add.getByLabel("Email").fill(`site${stamp}@dune.test`);
  await add.getByLabel("Name").fill("Petrus Site");
  await add.getByRole("button", { name: "Add member" }).click();
  await expect(add.getByRole("status")).toContainText("Added");
  await page.getByTestId("members-table").getByRole("row", { name: /Petrus Site/ }).getByRole("button", { name: "Copy invite link" }).click();
  const invite = await page.evaluate(() => navigator.clipboard.readText());

  // upload a two-page PDF to Plans and open it in the viewer
  await page.getByRole("link", { name: "Document Control" }).click();
  await expect(page.getByRole("heading", { name: "Plans", level: 2 })).toBeVisible();
  await page.getByLabel("Choose files to upload").setInputFiles([{ name: "A-201 Sections.pdf", mimeType: "application/pdf", buffer: await samplePdf() }]);
  await expect(page.getByTestId("upload-list").getByText("Saved as V1")).toBeVisible();
  await page.getByTestId("file-row").getByTestId("view-link").click();

  const canvas = page.getByTestId("pdf-canvas");
  const layer = page.getByTestId("markup-layer");
  await expect(canvas).toHaveAttribute("data-rendered-page", "1");
  await expect(page.getByTestId("page-indicator")).toHaveText("Page 1 of 2");

  // page navigation and zoom
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByTestId("page-indicator")).toHaveText("Page 2 of 2");
  await expect(canvas).toHaveAttribute("data-rendered-page", "2");
  const zoomBefore = await page.getByTestId("zoom-level").innerText();
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(page.getByTestId("zoom-level")).not.toHaveText(zoomBefore);
  const widthIn = (await layer.boundingBox())!.width;
  await page.getByRole("button", { name: "Zoom out" }).click();
  expect((await layer.boundingBox())!.width).toBeLessThan(widthIn);
  await page.getByRole("button", { name: "Fit" }).click();

  const tools = page.getByRole("toolbar", { name: "Markup tools" });
  const items = page.getByTestId("markup-item");

  // rectangle, cloud, arrow, pen and text (all private at first)
  await tools.getByRole("button", { name: "Rectangle" }).click();
  await drag(page, layer, [60, 60], [200, 140]);
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText("Private");
  await tools.getByRole("button", { name: "Cloud" }).click();
  await drag(page, layer, [300, 60], [420, 140]);
  await tools.getByRole("button", { name: "Arrow" }).click();
  await drag(page, layer, [450, 200], [380, 150]);
  await tools.getByRole("button", { name: "Pen" }).click();
  await drag(page, layer, [80, 300], [200, 340]);
  await tools.getByRole("button", { name: "Text" }).click();
  await click(page, layer, [240, 200]);
  await page.getByLabel("Markup text").fill("Check slab level");
  await page.getByRole("button", { name: "Add text" }).click();
  await expect(items).toHaveCount(5);
  await expect(page.getByTestId("markup-shape")).toHaveCount(5);

  // calibrate: a 100 pt line is 5 m, so 200 pt measures 10 m
  await tools.getByRole("button", { name: "Set scale" }).click();
  await drag(page, layer, [220, 30], [320, 30]);
  await page.getByLabel("Real length").fill("5");
  await page.getByLabel("Unit").selectOption("m");
  await page.getByRole("button", { name: "Set scale", exact: true }).last().click();
  await expect(page.getByTestId("scale-status")).toHaveText("Scale set (m)");
  await expect(tools.getByRole("button", { name: "Length" })).toHaveAttribute("aria-pressed", "true");
  await click(page, layer, [300, 250]);
  await click(page, layer, [500, 250]);
  await tools.getByRole("button", { name: "Finish" }).click();
  await expect(items).toHaveCount(6);
  const lengthText = await page.getByTestId("measure-label").first().textContent();
  const meters = parseFloat(lengthText!);
  expect(lengthText).toMatch(/ m$/);
  expect(meters).toBeGreaterThan(9.7);
  expect(meters).toBeLessThan(10.3);

  // area: a 100 × 100 pt square is 25 m²
  await tools.getByRole("button", { name: "Area" }).click();
  for (const p of [[20, 160], [120, 160], [120, 260], [20, 260]] as [number, number][]) await click(page, layer, p);
  await tools.getByRole("button", { name: "Finish" }).click();
  await expect(items).toHaveCount(7);
  const area = parseFloat((await page.getByTestId("measure-label").nth(1).textContent())!);
  expect(area).toBeGreaterThan(23.5);
  expect(area).toBeLessThan(26.5);

  // publish the rectangle and the text; delete the pen stroke
  await items.filter({ hasText: "Rectangle" }).getByRole("button", { name: "Publish" }).click();
  await expect(items.filter({ hasText: "Rectangle" })).toContainText("Published");
  await items.filter({ hasText: "Check slab level" }).getByRole("button", { name: "Publish" }).click();
  await expect(items.filter({ hasText: "Check slab level" })).toContainText("Published");
  page.once("dialog", (d) => d.accept());
  await items.filter({ hasText: "Pen" }).getByRole("button", { name: "Delete" }).click();
  await expect(items).toHaveCount(6);

  // markups persist across reloads
  await page.reload();
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(items).toHaveCount(6);
  await expect(page.getByTestId("scale-status")).toHaveText("Scale set (m)");

  // export flattens only the published markups
  const exportHref = await page.getByRole("link", { name: "Export PDF" }).getAttribute("href");
  const res = await page.request.get(exportHref!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("application/pdf");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const fonts = `${process.cwd()}/node_modules/pdfjs-dist/standard_fonts/`;
  const exported = await pdfjs.getDocument({ data: new Uint8Array(await res.body()), standardFontDataUrl: fonts }).promise;
  expect(exported.numPages).toBe(2);
  const text = async (n: number) => (await (await exported.getPage(n)).getTextContent()).items.map((i) => ("str" in i ? i.str : "")).join(" ");
  expect(await text(2)).toContain("Check slab level");
  expect(await text(2)).not.toContain(" m"); // the private length/area labels aren't exported
  expect(await text(1)).not.toContain("Check slab level");

  // the Viewer sees published markups only, and can't publish or calibrate
  const ctx = await browser.newContext();
  const guest = await ctx.newPage();
  await guest.goto(invite);
  await guest.getByLabel("Password").fill("password456");
  await guest.getByRole("button", { name: "Join project" }).click();
  await guest.getByRole("link", { name: /Sossusvlei Desert Suites/ }).click();
  await expect(guest.getByRole("heading", { name: "Plans", level: 2 })).toBeVisible();
  await guest.getByTestId("file-row").getByTestId("view-link").click();
  await expect(guest.getByTestId("pdf-canvas")).toHaveAttribute("data-rendered-page", "1");
  await guest.getByRole("button", { name: "Next page" }).click();
  const guestItems = guest.getByTestId("markup-item");
  await expect(guestItems).toHaveCount(2);
  await expect(guestItems.filter({ hasText: "Private" })).toHaveCount(0);
  await expect(guest.getByRole("toolbar", { name: "Markup tools" }).getByRole("button", { name: "Set scale" })).toHaveCount(0);
  await expect(guestItems.getByRole("button", { name: "Delete" })).toHaveCount(0);
  // they can add a private markup of their own, but not publish it
  await guest.getByRole("toolbar", { name: "Markup tools" }).getByRole("button", { name: "Rectangle" }).click();
  await drag(guest, guest.getByTestId("markup-layer"), [400, 250], [520, 330]);
  await expect(guestItems).toHaveCount(3);
  await expect(guestItems.last()).toContainText("Private");
  await expect(guestItems.last().getByRole("button", { name: "Publish" })).toHaveCount(0);
  await ctx.close();

  // ...and the admin doesn't see the guest's private markup
  await page.reload();
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(items).toHaveCount(6);

  // audit trail
  await page.goto(page.url().replace(/\/viewer\/.*/, "/admin/activity"));
  for (const a of ["markup.created", "markup.published", "markup.deleted", "sheet.calibrated", "document.exported_with_markups"])
    await expect(page.getByRole("cell", { name: a, exact: true }).first()).toBeVisible();
});

test("viewer works at phone width", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 760 } });
  const page = await ctx.newPage();
  const stamp = Date.now();
  await page.goto("/signup");
  await page.getByLabel("Organisation").fill(`Phone Viewer ${stamp}`);
  await page.getByLabel("Your name").fill("Thabo Phone");
  await page.getByLabel("Work email").fill(`pv${stamp}@phone.test`);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Name").fill("Phone Camp");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByRole("link", { name: "Document Control" }).click();
  await expect(page.getByRole("heading", { name: "Plans", level: 2 })).toBeVisible();
  await page.getByLabel("Choose files to upload").setInputFiles([{ name: "Plan.pdf", mimeType: "application/pdf", buffer: await samplePdf() }]);
  await expect(page.getByTestId("upload-list").getByText("Saved as V1")).toBeVisible();
  await page.getByTestId("file-row").getByTestId("view-link").click();
  await expect(page.getByTestId("pdf-canvas")).toHaveAttribute("data-rendered-page", "1");
  const layer = page.getByTestId("markup-layer");
  await page.getByRole("toolbar", { name: "Markup tools" }).getByRole("button", { name: "Rectangle" }).click();
  await drag(page, layer, [100, 100], [300, 250]);
  await expect(page.getByTestId("markup-item")).toHaveCount(1);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await ctx.close();
});

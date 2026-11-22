import { expect, test, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/**
 * A3-landscape drawing set. Each page has a bottom-right title block (number + title),
 * a reference tag at the top-left, and a filled block whose position differs per version.
 */
async function drawingSet(version: 1 | 2) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const sheets: [string, string, string][] = [
    ["A-101", "GROUND FLOOR PLAN", "K-501"],
    ["A-102", "ROOF PLAN", "K-502"],
    ["", "", ""], // empty title block → named after the file
  ];
  for (const [no, title, ref] of sheets) {
    const p = doc.addPage([1191, 842]);
    if (ref) p.drawText(`Ref ${ref}`, { x: 30, y: 800, size: 12, font });
    if (title) p.drawText(title, { x: 700, y: 40, size: 14, font });
    if (no) {
      p.drawText("Drawing No.", { x: 1000, y: 62, size: 7, font });
      p.drawText(no, { x: 1000, y: 40, size: 18, font });
    }
    // V1: block on the left; V2: block moved right
    p.drawRectangle({ x: version === 1 ? 200 : 600, y: 300, width: 200, height: 200, color: rgb(0, 0, 0) });
  }
  return { name: "Villa set.pdf", mimeType: "application/pdf", buffer: Buffer.from(await doc.save()) };
}

const numbers = (page: Page) => page.getByTestId("sheet-number").allTextContents();

test("sheets from PDFs, title block settings, editing, sets, Folders/Sets toggle and version comparison", async ({ page }) => {
  const stamp = Date.now();
  await page.goto("/signup");
  await page.getByLabel("Organisation").fill(`Kalahari Lodges ${stamp}`);
  await page.getByLabel("Your name").fill("Kgosi Controller");
  await page.getByLabel("Work email").fill(`sheets${stamp}@kalahari.test`);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Name").fill("Tswalu Desert Villas");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByRole("link", { name: "Document Control" }).click();
  await expect(page.getByRole("heading", { name: "Plans", level: 2 })).toBeVisible();

  // a three-page PDF uploaded to Plans becomes three sheets
  await page.getByLabel("Choose files to upload").setInputFiles([await drawingSet(1)]);
  await expect(page.getByTestId("upload-list").getByText("Saved as V1")).toBeVisible();
  await page.getByRole("group", { name: "Browse by" }).getByRole("link", { name: "Sets" }).click();
  await expect(page.getByRole("heading", { name: "All current sheets" })).toBeVisible();
  await expect(page.getByTestId("sheet-row")).toHaveCount(3);
  await expect.poll(() => numbers(page)).toEqual(["A-101", "A-102", "Villa set p3"]);
  await expect(page.getByTestId("sheet-row").first().getByTestId("sheet-title")).toHaveText("GROUND FLOOR PLAN");

  // edit the third sheet by hand
  const third = page.getByTestId("sheet-row").filter({ hasText: "Villa set p3" });
  await third.getByText("Edit", { exact: true }).click();
  await third.getByLabel("Sheet number").fill("A-103");
  await third.getByLabel("Sheet title").fill("SECTIONS");
  await third.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("sheet-row").filter({ hasText: "SECTIONS" }).getByTestId("sheet-number")).toHaveText("A-103");

  // configurable title block: read the number from the top-left tag instead, then re-read
  await page.getByRole("link", { name: "Title block settings" }).click();
  const tb = page.getByTestId("titleblock-form");
  for (const [k, v] of [["numberX", "0"], ["numberY", "0"], ["numberW", "25"], ["numberH", "8"]]) await tb.locator(`#${k}`).fill(v);
  await tb.getByRole("button", { name: "Save" }).click();
  await expect(tb.getByRole("status")).toContainText("Saved");
  await page.getByTestId("rebuild-form").getByRole("button", { name: "Re-read all sheets" }).click();
  await expect(page.getByTestId("rebuild-form").getByRole("status")).toContainText("Re-read 3 sheets");
  await page.getByRole("link", { name: "← Sheets" }).click();
  await expect.poll(() => numbers(page)).toEqual(["A-103", "K-501", "K-502"]); // the hand-edited sheet kept its edit
  // invalid box is refused
  await page.getByRole("link", { name: "Title block settings" }).click();
  await tb.locator("#numberX").fill("90");
  await tb.locator("#numberW").fill("20");
  await tb.getByRole("button", { name: "Save" }).click();
  await expect(tb.getByRole("alert")).toContainText("must stay on the page");
  // back to the bottom-right title block
  for (const [k, v] of [["numberX", "82"], ["numberY", "90"], ["numberW", "17"], ["numberH", "9"]]) await tb.locator(`#${k}`).fill(v);
  await tb.getByRole("button", { name: "Save" }).click();
  await expect(tb.getByRole("status")).toContainText("Saved");
  await page.getByTestId("rebuild-form").getByRole("button", { name: "Re-read all sheets" }).click();
  await expect(page.getByTestId("rebuild-form").getByRole("status")).toContainText("Re-read");
  await page.getByRole("link", { name: "← Sheets" }).click();
  await expect.poll(() => numbers(page)).toEqual(["A-101", "A-102", "A-103"]);

  // sets: Tender gets V1 of A-101 and A-102
  for (const name of ["Tender", "IFC Rev B"]) {
    await page.getByTestId("new-set-form").getByLabel("Set name").fill(name);
    await page.getByTestId("new-set-form").getByRole("button", { name: "Create set" }).click();
    await expect(page.getByTestId("new-set-form").getByRole("status")).toContainText(`Created set ${name}`);
  }
  await page.getByTestId("new-set-form").getByLabel("Set name").fill("tender");
  await page.getByTestId("new-set-form").getByRole("button", { name: "Create set" }).click();
  await expect(page.getByTestId("new-set-form").getByRole("status")).toContainText("Created set tender"); // names are case-sensitive
  await page.getByLabel("Select A-101").check();
  await page.getByLabel("Select A-102").check();
  const addTo = page.getByTestId("add-to-set-form");
  await addTo.getByLabel("Set").selectOption({ label: "Tender" });
  await addTo.getByRole("button", { name: "Add to set" }).click();
  await expect(addTo.getByRole("status")).toContainText("Added 2 sheets to Tender");
  const setsNav = page.getByTestId("sets-nav");
  await expect(setsNav.getByRole("link", { name: /^Tender/ })).toContainText("2");

  // V2 of the same file: All current sheets moves to V2, Tender keeps V1
  await page.getByRole("group", { name: "Browse by" }).getByRole("link", { name: "Folders" }).click();
  await expect(page.getByRole("heading", { name: "Plans", level: 2 })).toBeVisible();
  await page.getByLabel("Choose files to upload").setInputFiles([await drawingSet(2)]);
  await expect(page.getByTestId("upload-list").getByText("Saved as V2")).toBeVisible();
  await page.getByRole("group", { name: "Browse by" }).getByRole("link", { name: "Sets" }).click();
  await expect(page.getByTestId("sheet-row")).toHaveCount(3);
  await expect(page.getByTestId("sheet-row").filter({ hasText: "A-101" })).toContainText("V2");
  // the hand edit belonged to V1's sheet; V2's third page is read afresh
  await expect.poll(() => numbers(page)).toEqual(["A-101", "A-102", "Villa set p3"]);
  await setsNav.getByRole("link", { name: /^Tender/ }).click();
  await expect(page.getByRole("heading", { name: "Tender" })).toBeVisible();
  await expect(page.getByTestId("sheet-row")).toHaveCount(2);
  for (const r of await page.getByTestId("sheet-row").all()) await expect(r).toContainText("V1");
  // remove one from the set
  await page.getByRole("button", { name: "Remove A-102 from this set" }).click();
  await expect(page.getByTestId("sheet-row")).toHaveCount(1);

  // a sheet number opens the viewer on that page
  await setsNav.getByRole("link", { name: "All current sheets" }).click();
  await page.getByTestId("sheet-row").filter({ hasText: "A-102" }).getByTestId("sheet-number").click();
  await expect(page.getByTestId("page-indicator")).toHaveText("Page 2 of 3");
  await page.goBack();

  // compare A-101 V1 ↔ V2: side by side, then overlay
  await page.getByTestId("sheet-row").filter({ hasText: "A-101" }).getByRole("link", { name: /Compare A-101/ }).click();
  const area = page.getByTestId("compare-area");
  await expect(area).toHaveAttribute("data-status", "ready");
  await expect(area.locator('[data-testid="compare-canvas"]')).toHaveCount(2);
  await expect(page.getByText("V1 · A-101 GROUND FLOOR PLAN")).toBeVisible();
  await expect(page.getByText("V2 · A-101 GROUND FLOOR PLAN")).toBeVisible();
  await page.getByRole("button", { name: "Overlay" }).click();
  await expect(area).toHaveAttribute("data-mode", "overlay");
  await expect(area).toHaveAttribute("data-status", "ready");
  await expect(page.getByTestId("overlay-legend")).toContainText("Only in V1");
  // V1's block (x 200–400 pt) is only in V1 → red; V2's (x 600–800 pt) only in V2 → blue; y 300–500 pt from the bottom
  const pixel = (fx: number, fy: number) =>
    page.evaluate(
      ([x, y]) => {
        const c = document.querySelector('[data-testid="overlay-canvas"]') as HTMLCanvasElement;
        return Array.from(c.getContext("2d")!.getImageData(Math.round(c.width * x), Math.round(c.height * y), 1, 1).data);
      },
      [fx, fy],
    );
  const midY = 1 - 400 / 842;
  expect(await pixel(300 / 1191, midY)).toEqual([255, 0, 0, 255]);
  expect(await pixel(700 / 1191, midY)).toEqual([0, 0, 255, 255]);
  expect((await pixel(1000 / 1191, 0.2)).slice(0, 3)).toEqual([255, 255, 255]); // blank paper stays white

  // the viewer offers the comparison too
  await page.getByRole("link", { name: "← Back" }).click();
  await expect(page.getByRole("link", { name: "Compare with V1" })).toBeVisible();

  // audit trail
  await page.getByRole("link", { name: "Project Admin" }).click();
  await page.getByRole("link", { name: "Activity" }).click();
  for (const a of ["sheet.edited", "titleblock.updated", "sheets.rebuilt", "set.created", "set.sheets_added", "set.sheet_removed"])
    await expect(page.getByRole("cell", { name: a, exact: true }).first()).toBeVisible();
});

test("sets work at phone width", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 760 } });
  const page = await ctx.newPage();
  const stamp = Date.now();
  await page.goto("/signup");
  await page.getByLabel("Organisation").fill(`Phone Sheets ${stamp}`);
  await page.getByLabel("Your name").fill("Lindiwe Phone");
  await page.getByLabel("Work email").fill(`ps${stamp}@phone.test`);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Name").fill("Phone Lodge");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByRole("link", { name: "Document Control" }).click();
  await expect(page.getByRole("heading", { name: "Plans", level: 2 })).toBeVisible();
  await page.getByLabel("Choose files to upload").setInputFiles([await drawingSet(1)]);
  await expect(page.getByTestId("upload-list").getByText("Saved as V1")).toBeVisible();
  await page.getByRole("group", { name: "Browse by" }).getByRole("link", { name: "Sets" }).click();
  await expect(page.getByTestId("sheet-row")).toHaveCount(3);
  await page.getByTestId("sheet-row").first().getByText("Edit", { exact: true }).click();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await ctx.close();
});

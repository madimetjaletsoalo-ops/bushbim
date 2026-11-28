import { expect, test, type Browser, type Page } from "@playwright/test";
import { strToU8, zipSync } from "fflate";
import { PDFDocument, StandardFonts } from "pdf-lib";

async function textPdf(name: string, lines: string[]) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([600, 400]);
  lines.forEach((l, i) => page.drawText(l, { x: 40, y: 350 - i * 24, size: 14, font }));
  return { name, mimeType: "application/pdf", buffer: Buffer.from(await doc.save()) };
}

/** A "scanned" PDF: page 1 is a JPEG of text, page 2 a PNG (stored Flate-compressed), no text layer. */
async function scannedPdf(browser: Browser, name: string, page1: string, page2: string) {
  const shot = await (await browser.newContext({ viewport: { width: 1000, height: 260 } })).newPage();
  const render = async (text: string, type: "jpeg" | "png") => {
    await shot.setContent(`<body style="margin:0;background:#fff;font:bold 44px Arial,sans-serif;padding:40px">${text}</body>`);
    return shot.screenshot(type === "jpeg" ? { type, quality: 85 } : { type });
  };
  const doc = await PDFDocument.create();
  for (const img of [await doc.embedJpg(await render(page1, "jpeg")), await doc.embedPng(await render(page2, "png"))]) {
    doc.addPage([img.width, img.height]).drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  }
  await shot.context().close();
  return { name, mimeType: "application/pdf", buffer: Buffer.from(await doc.save()) };
}

function docx(name: string, text: string) {
  const zip = zipSync({
    "[Content_Types].xml": strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    "word/document.xml": strToU8(`<?xml version="1.0"?><w:document xmlns:w="w"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`),
  });
  return { name, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from(zip) };
}

function xlsx(name: string, item: string, qty: number) {
  const zip = zipSync({
    "xl/workbook.xml": strToU8('<workbook><sheets><sheet name="BoQ" sheetId="1"/></sheets></workbook>'),
    "xl/sharedStrings.xml": strToU8(`<sst><si><t>${item}</t></si></sst>`),
    "xl/worksheets/sheet1.xml": strToU8(`<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>${qty}</v></c></row></sheetData></worksheet>`),
  });
  return { name, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(zip) };
}

async function search(page: Page, base: string, params: Record<string, string>) {
  await page.goto(`${base}/search?${new URLSearchParams(params)}`);
}

/** Reloads the search until a document shows up: indexing runs in the background after upload. */
async function waitForDocument(page: Page, base: string, q: string, name: string) {
  await expect(async () => {
    await search(page, base, { q, kind: "documents" });
    await expect(page.getByTestId("results-documents").getByRole("link", { name })).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 90_000, intervals: [1000, 2000, 3000] });
}

test("full-text search across files (PDF text, OCR, Word, Excel), issues, name patterns and folder access", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);

  await page.goto("/signup");
  await page.getByLabel("Organisation").fill(`Okavango Retreats ${stamp}`);
  await page.getByLabel("Your name").fill("Kagiso Controller");
  await page.getByLabel("Work email").fill(`search${stamp}@okavango.test`);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Name").fill("Delta Island Camp");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { name: "Members" })).toBeVisible();
  const base = page.url().replace(/\/admin.*$/, "");

  // a Document Control member
  const add = page.getByTestId("add-member-form");
  await add.getByLabel("Email").fill(`mpho${stamp}@okavango.test`);
  await add.getByLabel("Name").fill("Mpho Engineer");
  await add.getByRole("button", { name: "Add member" }).click();
  await expect(add.getByRole("status")).toContainText("Added");
  await page.getByTestId("members-table").getByRole("row", { name: /Mpho Engineer/ }).getByRole("button", { name: "Copy invite link" }).click();
  const invite = await page.evaluate(() => navigator.clipboard.readText());

  // files of every kind into Project Files
  await page.getByRole("link", { name: "Document Control" }).click();
  const tree = page.getByTestId("folder-tree");
  await tree.getByRole("link", { name: "Project Files" }).click();
  await expect(page.getByRole("heading", { name: "Project Files", level: 2 })).toBeVisible();
  const chooser = page.getByLabel("Choose files to upload");
  await chooser.setInputFiles([
    await textPdf("General notes.pdf", ["All waterproofing membranes to be torch-on bitumen.", "Refer to KLV-ARC-101 for falls."]),
    await scannedPdf(browser, "Scanned site instruction.pdf", "SITE INSTRUCTION Relocate plunge pool pump", "Boma lighting circuit"),
    docx("Finishes schedule.docx", "Mopane timber decking oiled twice"),
    xlsx("BoQ rates.xlsx", "Cape reed thatch bundles", 1200),
    await textPdf("KLV-ARC-101 Floor plan.pdf", ["Floor plan"]),
    await textPdf("KLV-ARC-102 Roof plan.pdf", ["Roof plan"]),
    await textPdf("Sketch final v2.pdf", ["Sketch"]),
  ]);
  await expect(page.getByTestId("upload-list").getByText("Saved as V1")).toHaveCount(7);

  // a private folder the member can't open
  await page.getByText("New folder", { exact: true }).click();
  await page.getByTestId("new-folder-form").getByLabel("Folder name").fill("Commercial");
  await page.getByTestId("new-folder-form").getByRole("button", { name: "Create" }).click();
  await tree.getByRole("link", { name: "Commercial" }).click();
  await expect(page.getByRole("heading", { name: "Commercial", level: 2 })).toBeVisible();
  await page.getByLabel("Choose files to upload").setInputFiles([await textPdf("Valuation 03.pdf", ["Retention release requested for the lodge deck."])]);
  await expect(page.getByTestId("upload-list").getByText("Saved as V1")).toBeVisible();
  await page.getByTestId("folder-permissions").getByText(/Permissions/).first().click();
  const grant = page.getByTestId("folder-grant-form");
  await grant.getByLabel("Grant to").selectOption({ label: "Project members (default)" });
  await grant.getByLabel("Level").selectOption("NONE");
  await grant.getByRole("button", { name: "Save" }).click();
  await expect(grant.getByRole("status")).toContainText("Saved: No access");

  // an issue that mentions the pump
  await page.goto(`${base}/issues/new`);
  const form = page.getByTestId("issue-form");
  await form.getByLabel("Title").fill("Leaking pump seal");
  await form.getByLabel("Description").fill("Plunge pool pump seal weeping at villa 4.");
  await form.getByRole("button", { name: "Create issue" }).click();
  await expect(page.getByRole("heading", { name: /#1 Leaking pump seal/ })).toBeVisible();

  // Search is in the project navigation
  await page.getByRole("navigation", { name: "Modules" }).getByRole("link", { name: "Search" }).click();
  await expect(page.getByRole("heading", { name: "Search", level: 2 })).toBeVisible();

  // text-layer PDF: prefix and word forms match, with a highlighted snippet
  await waitForDocument(page, base, "waterproof", "General notes.pdf");
  const notes = page.getByTestId("results-documents").getByTestId("hit").filter({ hasText: "General notes.pdf" });
  await expect(notes).toContainText("PDF text");
  await expect(notes.getByTestId("snippet").locator("mark").first()).toHaveText(/waterproofing/i);
  // a code written with hyphens is found as a phrase
  await search(page, base, { q: "KLV-ARC-101", kind: "documents" });
  await expect(page.getByTestId("results-documents").getByRole("link", { name: "General notes.pdf" })).toBeVisible();

  // scanned PDF read by OCR: the JPEG page and the PNG page
  await waitForDocument(page, base, "plunge pool pump", "Scanned site instruction.pdf");
  await expect(page.getByTestId("results-documents").getByTestId("hit").filter({ hasText: "Scanned site instruction.pdf" })).toContainText("OCR");
  await waitForDocument(page, base, "boma lighting", "Scanned site instruction.pdf");

  // Word and Excel
  await waitForDocument(page, base, "mopane decking", "Finishes schedule.docx");
  await waitForDocument(page, base, "reed bundles", "BoQ rates.xlsx");

  // everything at once: the scan and the issue both mention the pump
  await search(page, base, { q: "plunge pump" });
  await expect(page.getByTestId("results-documents").getByRole("link", { name: "Scanned site instruction.pdf" })).toBeVisible();
  await expect(page.getByTestId("results-issues").getByRole("link", { name: "Leaking pump seal" })).toBeVisible();
  await expect(page.getByTestId("results-issues").getByTestId("snippet").locator("mark").first()).toHaveText(/plunge|pump/i);
  // by number, and limited to issues
  await search(page, base, { q: "#1", kind: "issues" });
  await expect(page.getByTestId("results-issues").getByRole("link", { name: "Leaking pump seal" })).toBeVisible();
  await expect(page.getByTestId("results-documents")).toHaveCount(0);
  // exclusions and nothing found
  await search(page, base, { q: "plunge -seal", kind: "issues" });
  await expect(page.getByTestId("results-issues")).toContainText("No matches.");

  // ⭐ naming pattern from the form, with the search box empty
  await page.getByLabel("Search for").fill("");
  await page.getByText("Filter by name pattern").click();
  await page.getByLabel("Naming pattern").check();
  await page.getByLabel("Name pattern").fill("KLV-ARC-###*");
  await page.getByTestId("search-form").getByLabel("Search in").selectOption("documents");
  await page.getByTestId("search-form").getByRole("button", { name: "Search" }).click();
  const docsHits = page.getByTestId("results-documents").getByTestId("hit");
  await expect(docsHits).toHaveCount(2);
  await expect(docsHits.filter({ hasText: "KLV-ARC-101 Floor plan.pdf" })).toHaveCount(1);
  await expect(docsHits.filter({ hasText: "KLV-ARC-102 Roof plan.pdf" })).toHaveCount(1);
  // inverted: files off the naming convention
  await page.getByLabel("Show names that").check();
  await page.getByTestId("search-form").getByRole("button", { name: "Search" }).click();
  await expect(docsHits.filter({ hasText: "Sketch final v2.pdf" })).toHaveCount(1);
  await expect(docsHits.filter({ hasText: "KLV-ARC" })).toHaveCount(0);
  // ⭐ regular expression combined with words
  await search(page, base, { q: "plan", kind: "documents", mode: "regex", name: "^klv-.*-102" });
  await expect(docsHits).toHaveCount(1);
  await expect(docsHits).toContainText("KLV-ARC-102 Roof plan.pdf");
  await search(page, base, { q: "plan", mode: "regex", name: "([" });
  await expect(page.getByRole("alert").filter({ hasText: "regular expression" })).toContainText("valid regular expression");

  // the result opens the file in the viewer
  await search(page, base, { q: "waterproofing", kind: "documents" });
  await page.getByTestId("results-documents").getByRole("link", { name: "General notes.pdf" }).click();
  await expect(page).toHaveURL(/\/viewer\//);

  // admins see the index and can re-index
  await waitForDocument(page, base, "retention", "Valuation 03.pdf");
  const status = page.getByTestId("index-status");
  await expect(status.getByTestId("index-failed")).toHaveText("0");
  await expect(status.getByTestId("index-done")).toHaveText("8");
  await page.getByTestId("index-all").getByRole("button", { name: "Re-index all files" }).click();
  await expect(page.getByTestId("index-all").getByRole("status")).toContainText(/Indexed \d+ files?/, { timeout: 60_000 });

  // the member sees public files but nothing from the private folder
  const mpho = await (await browser.newContext()).newPage();
  await mpho.goto(invite);
  await mpho.getByLabel("Password").fill("password456");
  await mpho.getByRole("button", { name: "Join project" }).click();
  await expect(mpho.getByRole("heading", { name: "Projects" })).toBeVisible();
  await search(mpho, base, { q: "retention", kind: "documents" });
  await expect(mpho.getByTestId("results-documents")).toContainText("No matches.");
  await search(mpho, base, { q: "waterproofing", kind: "documents" });
  await expect(mpho.getByTestId("results-documents").getByRole("link", { name: "General notes.pdf" })).toBeVisible();
  await expect(mpho.getByTestId("index-status")).toHaveCount(0);

  // usable at phone width
  await mpho.setViewportSize({ width: 375, height: 800 });
  await search(mpho, base, { q: "waterproofing" });
  expect(await mpho.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

import { expect, test, type Locator, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { jpegSize } from "../../src/modules/issues/media";

const OPEN = "#f59e0b";
const CLOSED = "#16a34a";

async function samplePdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([600, 400]).drawText("POOL DECK PLAN", { x: 40, y: 360, size: 20, font });
  return Buffer.from(await doc.save());
}

/** A large PNG drawn in the browser, like an uncompressed phone photo. */
async function bigPng(page: Page, w: number, h: number) {
  const b64 = await page.evaluate(
    async ([w, h]) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const g = c.getContext("2d")!;
      const grad = g.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, "#2e6b4f");
      grad.addColorStop(1, "#e9c46a");
      g.fillStyle = grad;
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

async function clickAt(page: Page, layer: Locator, x: number, y: number) {
  const box = (await layer.boundingBox())!;
  const z = box.width / 600;
  await page.mouse.click(box.x + x * z, box.y + y * z);
}

const noOverflow = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

test("issue pins on sheets with status colours, compressed photos and the project gallery", async ({ page, browser }) => {
  const stamp = Date.now();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/signup");
  await page.getByLabel("Organisation").fill(`Okavango Camps ${stamp}`);
  await page.getByLabel("Your name").fill("Lerato Manager");
  await page.getByLabel("Work email").fill(`pins${stamp}@okavango.test`);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Name").fill("Delta Water Villas");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { name: "Members" })).toBeVisible();

  // a Viewer teammate (Document Control + Issues at Viewer level)
  const add = page.getByTestId("add-member-form");
  await add.getByLabel("Email").fill(`kabo${stamp}@okavango.test`);
  await add.getByLabel("Name").fill("Kabo Viewer");
  await add.getByRole("button", { name: "Add member" }).click();
  await expect(add.getByRole("status")).toContainText("Added");
  await page.getByTestId("members-table").getByRole("row", { name: /Kabo Viewer/ }).getByRole("button", { name: "Copy invite link" }).click();
  const invite = await page.evaluate(() => navigator.clipboard.readText());

  // a sheet in Plans, and an issue to pin
  await page.getByRole("link", { name: "Document Control" }).click();
  await page.getByLabel("Choose files to upload").setInputFiles([{ name: "L-101 Pool deck.pdf", mimeType: "application/pdf", buffer: await samplePdf() }]);
  await expect(page.getByTestId("upload-list").getByText("Saved as V1")).toBeVisible();
  const viewerUrl = await page.getByTestId("file-row").getByTestId("view-link").getAttribute("href");

  await page.getByRole("link", { name: "Issues", exact: true }).click();
  await page.getByRole("navigation", { name: "Issues" }).getByRole("link", { name: "New issue" }).click();
  const form = page.getByTestId("issue-form");
  await form.getByLabel("Title").fill("Cracked screed at pool edge");
  await form.getByRole("button", { name: "Create issue" }).click();
  await expect(page.getByRole("heading", { name: /#1 Cracked screed/ })).toBeVisible();
  await expect(page.getByTestId("issue-pin")).toContainText("Not pinned");
  const issueUrl = page.url();

  // pin #1 on the sheet with the Pin tool: it shows the Open colour
  await page.goto(viewerUrl!);
  const layer = page.getByTestId("markup-layer");
  await expect(page.getByTestId("pdf-canvas")).toHaveAttribute("data-rendered-page", "1");
  const tools = page.getByRole("toolbar", { name: "Markup tools" });
  await tools.getByRole("button", { name: "Pin issue" }).click();
  await clickAt(page, layer, 200, 150);
  const pinForm = page.getByTestId("pin-form");
  await pinForm.getByLabel("Issue to pin here").selectOption({ label: "#1 Cracked screed at pool edge" });
  await pinForm.getByRole("button", { name: "Pin issue" }).click();
  const pins = page.getByTestId("issue-pin");
  await expect(pins).toHaveCount(1);
  await expect(pins.first()).toHaveAttribute("data-color", OPEN);
  await expect(page.getByTestId("pin-item")).toContainText("#1 Cracked screed");

  // "New issue here" creates #2 already pinned where the user clicked
  await clickAt(page, layer, 420, 260);
  await pinForm.getByRole("link", { name: "New issue here" }).click();
  await expect(page.getByTestId("pin-note")).toContainText("page 1");
  await form.getByLabel("Title").fill("Coping stone chipped");
  await form.getByRole("button", { name: "Create issue" }).click();
  await expect(page.getByRole("heading", { name: /#2 Coping stone/ })).toBeVisible();
  await expect(page.getByTestId("issue-pin")).toContainText("page 1");
  await expect(page.getByTestId("issue-activity")).toContainText("pinned it on a sheet");
  await page.getByRole("link", { name: "Open sheet at pin" }).click();
  await expect(pins).toHaveCount(2);

  // closing #1 turns its pin green
  await page.goto(issueUrl);
  const status = page.getByTestId("status-form");
  await status.getByLabel("Status", { exact: true }).selectOption({ label: "Closed" });
  await status.getByRole("button", { name: "Update status" }).click();
  await expect(page.getByTestId("issue-status")).toHaveText("Closed");
  await page.getByRole("link", { name: "Open sheet at pin" }).click();
  await expect(page.locator('[data-testid="issue-pin"][data-issue="1"]')).toHaveAttribute("data-color", CLOSED);
  await expect(page.locator('[data-testid="issue-pin"][data-issue="2"]')).toHaveAttribute("data-color", OPEN);

  // a 2400×1800 photo is compressed in the browser to a 1600 px wide JPEG
  await page.goto(issueUrl);
  const photos = page.getByTestId("issue-photos");
  await photos.getByLabel("Caption (optional)").fill("Crack runs 1.2 m along the edge");
  await photos.getByLabel("Choose photos").setInputFiles([{ name: "IMG_0412.png", mimeType: "image/png", buffer: await bigPng(page, 2400, 1800) }]);
  await expect(page.getByTestId("photo-upload-list")).toContainText("Saved, 1600×1200");
  await expect(photos.getByTestId("photo")).toHaveCount(1);
  await expect(photos.getByTestId("photo")).toContainText("Crack runs 1.2 m");
  await expect(page.getByTestId("issue-activity")).toContainText("added a photo");
  const href = await photos.getByTestId("photo").locator("a").first().getAttribute("href");
  const full = await page.request.get(href!);
  expect(full.ok()).toBe(true);
  expect(jpegSize(new Uint8Array(await full.body()))).toEqual({ width: 1600, height: 1200 });
  const thumb = await page.request.get(`${href}?size=thumb`);
  expect(jpegSize(new Uint8Array(await thumb.body()))?.width).toBe(320);

  // ⭐ the gallery lists it under Issues and inside Document Control; a project photo joins it
  await page.getByRole("navigation", { name: "Issues" }).getByRole("link", { name: "Photos" }).click();
  const grid = page.getByTestId("photo-grid").getByTestId("photo");
  await expect(grid).toHaveCount(1);
  await expect(grid.first().getByTestId("photo-issue")).toContainText("#1 Cracked screed");
  await page.getByLabel("Choose photos").setInputFiles([{ name: "arrival-jetty.png", mimeType: "image/png", buffer: await bigPng(page, 800, 600) }]);
  await expect(page.getByTestId("photo-upload-list")).toContainText("Saved, 800×600");
  await expect(grid).toHaveCount(2);
  await page.getByRole("link", { name: "Project photos" }).click();
  await expect(grid).toHaveCount(1);
  await expect(grid.first()).toContainText("Project photo");
  await page.getByRole("link", { name: "Document Control" }).click();
  await page.getByRole("link", { name: "Photos", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Photos", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/docs\/photos$/);
  await expect(grid).toHaveCount(2);

  // the Viewer sees pins and photos but can't pin, add photos or delete
  const viewer = await (await browser.newContext()).newPage();
  await viewer.goto(invite);
  await viewer.getByLabel("Password").fill("password456");
  await viewer.getByRole("button", { name: "Join project" }).click();
  await expect(viewer.getByRole("heading", { name: "Projects" })).toBeVisible();
  await viewer.goto(viewerUrl!);
  await expect(viewer.getByTestId("issue-pin")).toHaveCount(2);
  await expect(viewer.getByRole("toolbar", { name: "Markup tools" }).getByRole("button", { name: "Pin issue" })).toHaveCount(0);
  await viewer.goto(issueUrl);
  await expect(viewer.getByTestId("issue-photos").getByTestId("photo")).toHaveCount(1);
  await expect(viewer.getByTestId("issue-photos").getByLabel("Choose photos")).toHaveCount(0);
  await expect(viewer.getByTestId("issue-photos").getByRole("button", { name: "Delete" })).toHaveCount(0);
  await viewer.goto(issueUrl.replace(/issues\/.*$/, "issues/photos"));
  await expect(viewer.getByTestId("photo")).toHaveCount(2);
  await expect(viewer.getByLabel("Choose photos")).toHaveCount(0);
  // photo bytes need project access
  const anon = await (await browser.newContext()).newPage();
  const res = await anon.request.get(new URL(href!, page.url()).toString());
  expect(res.headers()["content-type"]).not.toContain("image/jpeg");

  // the manager removes the pin and deletes the photo
  await page.goto(issueUrl);
  page.on("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Remove pin" }).click();
  await expect(page.getByTestId("issue-pin")).toContainText("Not pinned");
  await page.getByTestId("issue-photos").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByTestId("issue-photos").getByTestId("photo")).toHaveCount(0);
  await expect(page.getByTestId("issue-activity")).toContainText("removed the pin");
  await expect(page.getByTestId("issue-activity")).toContainText("removed a photo");
  await page.goto(viewerUrl!);
  await expect(page.getByTestId("issue-pin")).toHaveCount(1);
});

test("pins and photos work at phone width", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 740 } });
  const page = await ctx.newPage();
  const stamp = Date.now();
  await page.goto("/signup");
  await page.getByLabel("Organisation").fill(`Phone Pins ${stamp}`);
  await page.getByLabel("Your name").fill("Site Lead");
  await page.getByLabel("Work email").fill(`phonepins${stamp}@camp.test`);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Name").fill("Phone Pin Camp");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { name: "Members" })).toBeVisible();
  await page.getByRole("link", { name: "Document Control" }).click();
  await page.getByLabel("Choose files to upload").setInputFiles([{ name: "L-102 Deck.pdf", mimeType: "application/pdf", buffer: await samplePdf() }]);
  await expect(page.getByTestId("upload-list").getByText("Saved as V1")).toBeVisible();
  await page.getByTestId("file-row").getByTestId("view-link").click();
  const layer = page.getByTestId("markup-layer");
  await expect(page.getByTestId("pdf-canvas")).toHaveAttribute("data-rendered-page", "1");
  await page.getByRole("toolbar", { name: "Markup tools" }).getByRole("button", { name: "Pin issue" }).click();
  await clickAt(page, layer, 300, 200);
  await expect(page.getByTestId("pin-form")).toBeInViewport();
  await page.getByTestId("pin-form").getByRole("link", { name: "New issue here" }).click();
  await page.getByTestId("issue-form").getByLabel("Title").fill("Deck board loose near the plunge pool");
  await page.getByTestId("issue-form").getByRole("button", { name: "Create issue" }).click();
  await expect(page.getByRole("heading", { name: /#1 Deck board/ })).toBeVisible();
  await page.getByTestId("issue-photos").getByLabel("Choose photos").setInputFiles([{ name: "deck.png", mimeType: "image/png", buffer: await bigPng(page, 3000, 4000) }]);
  await expect(page.getByTestId("photo-upload-list")).toContainText("Saved, 1600×2133");
  await noOverflow(page);
  await page.goto(page.url().replace(/issues\/.*$/, "issues/photos"));
  await expect(page.getByTestId("photo")).toHaveCount(1);
  await noOverflow(page);
  await ctx.close();
});

import { expect, test, type Browser, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";

async function drawing(name: string, label: string) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([600, 400]).drawText(label, { x: 40, y: 360, size: 20, font });
  return { name, mimeType: "application/pdf", buffer: Buffer.from(await doc.save()) };
}

async function signUpWithProject(page: Page, stamp: number, project: string) {
  await page.goto("/signup");
  await page.getByLabel("Organisation").fill(`Zambezi Escapes ${stamp}`);
  await page.getByLabel("Your name").fill("Lerato Controller");
  await page.getByLabel("Work email").fill(`tx${stamp}@zambezi.test`);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Name").fill(project);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { name: "Members" })).toBeVisible();
}

/** Adds a member (Document Control Viewer by default) and returns a signed-in page for them. */
async function inviteAndJoin(admin: Page, browser: Browser, email: string, name: string) {
  const add = admin.getByTestId("add-member-form");
  await add.getByLabel("Email").fill(email);
  await add.getByLabel("Name").fill(name);
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

async function copyLink(page: Page, recipient: string) {
  await page.getByTestId("recipient-row").filter({ hasText: recipient }).getByRole("button", { name: "Copy link" }).click();
  return page.evaluate(() => navigator.clipboard.readText());
}

test("send versions to members and external emails, no-login download, log, search and revoke", async ({ page, browser }) => {
  const stamp = Date.now();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await signUpWithProject(page, stamp, "Victoria Falls Lodge");
  const thandi = await inviteAndJoin(page, browser, `thandi${stamp}@zambezi.test`, "Thandi Architect");

  // two versions of a drawing, plus a second file
  await page.getByRole("link", { name: "Document Control" }).click();
  await page.getByTestId("folder-tree").getByRole("link", { name: "Project Files" }).click();
  await expect(page.getByRole("heading", { name: "Project Files", level: 2 })).toBeVisible();
  const chooser = page.getByLabel("Choose files to upload");
  await chooser.setInputFiles([await drawing("Spa pavilion.pdf", "SPA REV A"), await drawing("Roof plan.pdf", "ROOF")]);
  await expect(page.getByTestId("upload-list").getByText("Saved as V1")).toHaveCount(2);
  await chooser.setInputFiles([await drawing("Spa pavilion.pdf", "SPA REV B")]);
  await expect(page.getByTestId("upload-list").getByText("Saved as V2")).toBeVisible();

  // from the folder: Send transmittal
  await page.getByTestId("send-transmittal").click();
  const form = page.getByTestId("transmittal-form");
  await expect(form).toContainText("Showing Project Files");
  // validation: bad external address, nothing chosen
  await form.getByLabel("Subject").fill("Spa pavilion IFC");
  await form.getByLabel("Include Spa pavilion.pdf", { exact: true }).check();
  await form.getByLabel("External email addresses").fill("not-an-email");
  await form.getByRole("button", { name: "Send transmittal" }).click();
  await expect(form.getByRole("alert")).toContainText("Not a valid email address: not-an-email");
  // the form resets after a refused send, so fill it in again
  await form.getByLabel("Subject").fill("Spa pavilion IFC");
  await form.getByLabel("Include Spa pavilion.pdf", { exact: true }).check();
  await form.getByRole("button", { name: "Send transmittal" }).click();
  await expect(form.getByRole("alert")).toContainText("Choose at least one member or enter an email address");
  await form.getByLabel("Subject").fill("Spa pavilion IFC");
  await form.getByLabel("Include Spa pavilion.pdf", { exact: true }).check();
  // the latest Spa version plus the earlier one, to Thandi and an outside QS
  await form.getByText("Earlier versions").click();
  await form.getByLabel("Include Spa pavilion.pdf V1").check();
  await form.getByLabel("Send to Thandi Architect").check();
  await form.getByLabel("External email addresses").fill("QS Partners <QS@Partners.test>");
  await form.getByLabel("Links work for (days)").fill("7");
  await form.getByLabel("Message (optional)").fill("Please price the spa roof.");
  await form.getByRole("button", { name: "Send transmittal" }).click();

  await expect(page.getByRole("heading", { name: /T-1 Spa pavilion IFC/ })).toBeVisible();
  await expect(page.getByTestId("transmittal-status")).toContainText("Active");
  await expect(page.getByTestId("transmittal-files")).toContainText("Spa pavilion.pdf V2");
  await expect(page.getByTestId("transmittal-files")).toContainText("Spa pavilion.pdf V1");
  await expect(page.getByTestId("recipient-row")).toHaveCount(2);
  await expect(page.getByTestId("recipient-row").filter({ hasText: "qs@partners.test" })).toContainText("External");
  await expect(page.getByText("No downloads yet.")).toBeVisible();

  // the outside QS opens their link without signing in and downloads V2
  const qsLink = await copyLink(page, "qs@partners.test");
  const outside = await (await browser.newContext()).newPage();
  await outside.goto(qsLink);
  await expect(outside.getByRole("heading", { name: "Spa pavilion IFC" })).toBeVisible();
  await expect(outside.getByText("Please price the spa roof.")).toBeVisible();
  await expect(outside.getByText("To qs@partners.test", { exact: false })).toBeVisible();
  const files = outside.getByTestId("link-files");
  await expect(files.getByRole("listitem")).toHaveCount(2);
  const href = await files.getByRole("listitem").filter({ hasText: "V2" }).getByRole("link", { name: "Download Spa pavilion.pdf" }).getAttribute("href");
  const res = await outside.request.get(href!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("application/pdf");
  expect((await PDFDocument.load(await res.body())).getPageCount()).toBe(1);
  // a forged link is not found
  expect((await outside.request.get(qsLink.replace(/.$/, (c) => (c === "A" ? "B" : "A")))).status()).toBe(404);

  // the log records who downloaded what and when
  await page.reload();
  const log = page.getByTestId("download-row");
  await expect(log).toHaveCount(1);
  await expect(log).toContainText("qs@partners.test");
  await expect(log).toContainText("Spa pavilion.pdf V2");
  await expect(page.getByTestId("recipient-row").filter({ hasText: "qs@partners.test" })).not.toContainText("Not yet");

  // a second transmittal, to an outsider only
  await page.getByRole("navigation", { name: "Transmittals" }).getByRole("link", { name: "New transmittal" }).click();
  await form.getByLabel("Subject").fill("Roof drawings for the thatcher");
  await form.getByLabel("Include Roof plan.pdf").check();
  await form.getByLabel("External email addresses").fill("thatch@reeds.test");
  await form.getByRole("button", { name: "Send transmittal" }).click();
  await expect(page.getByRole("heading", { name: /T-2 Roof drawings/ })).toBeVisible();

  // ⭐ search the log by recipient, file, number and message text
  await page.getByRole("link", { name: "← Transmittals" }).click();
  await expect(page.getByTestId("transmittal-row")).toHaveCount(2);
  const search = async (q: string) => {
    await page.getByLabel("Search transmittals").fill(q);
    await page.getByRole("button", { name: "Search" }).click();
  };
  await search("qs@partners");
  await expect(page.getByTestId("transmittal-row")).toHaveCount(1);
  await expect(page.getByTestId("transmittal-row")).toContainText("Spa pavilion IFC");
  await expect(page.getByTestId("download-count")).toHaveText("1");
  await search("roof plan");
  await expect(page.getByTestId("transmittal-row")).toHaveCount(1);
  await expect(page.getByTestId("transmittal-row")).toContainText("Roof drawings");
  await search("T-1");
  await expect(page.getByTestId("transmittal-row")).toContainText("Spa pavilion IFC");
  await search("price spa");
  await expect(page.getByTestId("transmittal-row")).toHaveCount(1);
  await search("zebra");
  await expect(page.getByText("No transmittals match your search.")).toBeVisible();

  // Thandi (a Viewer) sees only the transmittal sent to her, only her own link, and can't send
  await thandi.getByRole("link", { name: /Victoria Falls Lodge/ }).click();
  await thandi.getByRole("link", { name: "Transmittals" }).first().click();
  await expect(thandi.getByTestId("transmittal-row")).toHaveCount(1);
  await expect(thandi.getByRole("link", { name: "New transmittal" })).toHaveCount(0);
  await thandi.getByTestId("transmittal-row").getByRole("link").first().click();
  await expect(thandi.getByRole("heading", { name: "Your link" })).toBeVisible();
  await expect(thandi.getByTestId("recipient-row")).toHaveCount(1);
  await expect(thandi.getByRole("button", { name: "Revoke links" })).toHaveCount(0);
  await thandi.goto(thandi.url().replace(/transmittals\/.*$/, "transmittals/new"));
  await expect(thandi.getByTestId("cannot-send")).toBeVisible();

  // revoke T-1: the outside link stops working
  await page.goto(page.url().replace(/transmittals.*$/, "transmittals"));
  await page.getByTestId("transmittal-row").filter({ hasText: "Spa pavilion IFC" }).getByRole("link").first().click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Revoke links" }).click();
  await expect(page.getByTestId("transmittal-status")).toContainText("Revoked");
  await expect(page.getByRole("button", { name: "Copy link" })).toHaveCount(0);
  await outside.reload();
  await expect(outside.getByTestId("link-state")).toContainText("revoked");
  expect((await outside.request.get(href!)).status()).toBe(410);

  // the activity log has the sends and the revoke
  await page.getByRole("link", { name: "Project Admin" }).click();
  await page.getByRole("link", { name: "Activity" }).click();
  await expect(page.getByText("transmittal.sent")).toHaveCount(2);
  await expect(page.getByText("transmittal.revoked")).toHaveCount(1);
});

test("transmittals work at phone width", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 740 } });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
  const page = await ctx.newPage();
  const stamp = Date.now();
  await signUpWithProject(page, stamp, "Phone Transmittal Camp");
  await page.getByRole("link", { name: "Document Control" }).click();
  await page.getByRole("button", { name: "Folders" }).click();
  await page.getByTestId("folder-tree").getByRole("link", { name: "Project Files" }).click();
  await expect(page.getByRole("heading", { name: "Project Files", level: 2 })).toBeVisible();
  await page.getByLabel("Choose files to upload").setInputFiles([await drawing("A very long villa handover drawing name for phones.pdf", "VILLA")]);
  await expect(page.getByTestId("upload-list").getByText("Saved as V1")).toBeVisible();
  await page.getByTestId("send-transmittal").click();
  const form = page.getByTestId("transmittal-form");
  await form.getByLabel("Subject").fill("Handover pack");
  await form.getByLabel(/^Include A very long villa/).check();
  await form.getByLabel("External email addresses").fill("owner@villa.test");
  const noOverflow = async (p: Page) => expect(await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await noOverflow(page);
  await form.getByRole("button", { name: "Send transmittal" }).click();
  await expect(page.getByRole("heading", { name: /T-1 Handover pack/ })).toBeVisible();
  await noOverflow(page);
  const link = await copyLink(page, "owner@villa.test");
  await page.goto(link);
  await expect(page.getByRole("heading", { name: "Handover pack" })).toBeVisible();
  await noOverflow(page);
  await ctx.close();
});

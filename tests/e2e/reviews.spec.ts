import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";

/** A one-page 600×400 pt PDF. */
async function drawing(name: string, label: string) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([600, 400]).drawText(label, { x: 40, y: 360, size: 20, font });
  return { name, mimeType: "application/pdf", buffer: Buffer.from(await doc.save()) };
}

async function drag(page: Page, layer: Locator, from: [number, number], to: [number, number]) {
  const box = (await layer.boundingBox())!;
  const z = box.width / 600;
  await page.mouse.move(box.x + from[0] * z, box.y + from[1] * z);
  await page.mouse.down();
  await page.mouse.move(box.x + to[0] * z, box.y + to[1] * z, { steps: 6 });
  await page.mouse.up();
}

/** Adds a member (Document Control + Issues, Viewer by default) and returns a signed-in page for them. */
async function inviteAndJoin(admin: Page, browser: Browser, email: string, name: string) {
  await admin.getByRole("link", { name: "Project Admin" }).click();
  await admin.getByRole("link", { name: "Members" }).click();
  const add = admin.getByTestId("add-member-form");
  await add.getByLabel("Email").fill(email);
  await add.getByLabel("Name").fill(name);
  await add.getByRole("button", { name: "Add member" }).click();
  await expect(add.getByRole("status")).toContainText(`Added ${email}`);
  await admin.getByTestId("members-table").getByRole("row", { name: new RegExp(name) }).getByRole("button", { name: "Copy invite link" }).click();
  const link = await admin.evaluate(() => navigator.clipboard.readText());
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(link);
  await page.getByLabel("Password").fill("password456");
  await page.getByRole("button", { name: "Join project" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  return page;
}

async function newFolder(page: Page, parent: string, name: string) {
  const tree = page.getByTestId("folder-tree");
  await tree.getByRole("link", { name: parent }).click();
  await expect(page.getByRole("heading", { name: parent, level: 2 })).toBeVisible();
  const field = page.getByTestId("new-folder-form").getByLabel("Folder name");
  if (!(await field.isVisible())) await page.getByText("New folder", { exact: true }).click();
  await field.fill(name);
  await page.getByTestId("new-folder-form").getByRole("button", { name: "Create" }).click();
  await expect(tree.getByRole("link", { name })).toBeVisible();
}

test("workflows, auto-start on upload, two-step review with comments and markups, copy approved, search and export", async ({ page, browser }) => {
  const stamp = Date.now();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/signup");
  await page.getByLabel("Organisation").fill(`Okavango Retreats ${stamp}`);
  await page.getByLabel("Your name").fill("Lerato Admin");
  await page.getByLabel("Work email").fill(`reviews${stamp}@okavango.test`);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Name").fill("Delta Tented Camp");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { name: "Members" })).toBeVisible();

  const architect = await inviteAndJoin(page, browser, `arch${stamp}@okavango.test`, "Thandi Architect");
  const outsider = await inviteAndJoin(page, browser, `site${stamp}@okavango.test`, "Sipho Site");

  // folders: For review (auto-start) and Approved (destination)
  await page.getByRole("link", { name: "Document Control" }).click();
  await newFolder(page, "Project Files", "For review");
  await newFolder(page, "Project Files", "Approved");

  // a two-step workflow: architect, then the admin as client
  await page.getByRole("link", { name: "Reviews" }).first().click();
  await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible();
  await page.getByRole("navigation", { name: "Reviews" }).getByRole("link", { name: "Workflows" }).click();
  const wf = page.getByTestId("workflow-form");
  await wf.getByLabel("Workflow name").fill("Design approval");
  await wf.getByLabel("Label for Revise & resubmit").fill("Revise and resubmit");
  await wf.getByLabel("Step 1 name").fill("Architect review");
  await wf.getByLabel("Step 1 reviewers").selectOption({ label: "Thandi Architect" });
  await wf.getByLabel("Step 1 days to review").fill("3");
  await wf.getByLabel("Step 2 name").fill("Client sign-off");
  await wf.getByLabel("Step 2 reviewers").selectOption({ label: "Lerato Admin" });
  await wf.getByLabel("Start automatically on upload to").selectOption({ label: "Project Files / For review" });
  await wf.getByLabel("Copy approved files to").selectOption({ label: "Project Files / Approved" });
  await wf.getByRole("button", { name: "Create workflow" }).click();
  await expect(wf.getByRole("status")).toContainText("Created workflow Design approval");
  const card = page.getByTestId("workflow-card").filter({ hasText: "Design approval" });
  await expect(card).toContainText("Step 1: Architect review");
  await expect(card).toContainText("Step 2: Client sign-off");
  await expect(card).toContainText("Revise and resubmit");
  // a step without reviewers is refused
  await wf.getByLabel("Workflow name").fill("Broken");
  await wf.getByLabel("Step 1 name").fill("Nobody");
  await wf.getByRole("button", { name: "Create workflow" }).click();
  await expect(wf.getByRole("alert")).toContainText("at least one reviewer");

  // uploading to For review starts a review automatically
  await page.getByRole("link", { name: "Document Control" }).click();
  await page.getByTestId("folder-tree").getByRole("link", { name: "For review" }).click();
  await expect(page.getByRole("heading", { name: "For review", level: 2 })).toBeVisible();
  await page.getByLabel("Choose files to upload").setInputFiles([await drawing("Main lodge plan.pdf", "MAIN LODGE")]);
  await expect(page.getByTestId("upload-list").getByText("Saved as V1")).toBeVisible();
  await page.getByRole("link", { name: "Reviews" }).first().click();
  const row = page.getByTestId("review-row").filter({ hasText: "Main lodge plan.pdf V1" });
  await expect(row).toContainText("auto");
  await expect(row).toContainText("Step 1 of 2 · Architect review");

  // a manual review from the folder's "Submit for review"
  await page.getByRole("link", { name: "Document Control" }).click();
  await page.getByTestId("folder-tree").getByRole("link", { name: "For review" }).click();
  await page.getByTestId("submit-for-review").click();
  const start = page.getByTestId("start-review-form");
  await start.getByLabel("Review name").fill("Deck balustrade check");
  await start.getByLabel("Include Main lodge plan.pdf").check();
  await start.getByRole("button", { name: "Start review" }).click();
  await expect(page.getByRole("heading", { name: /Deck balustrade check/ })).toBeVisible();
  await expect(page.getByTestId("review-status")).toContainText("Step 1 of 2: Architect review");
  // the admin isn't the step 1 reviewer, so there is no decision form yet
  await expect(page.getByTestId("decision-form")).toHaveCount(0);

  // the architect: sees both reviews awaiting them
  await architect.getByRole("link", { name: /Delta Tented Camp/ }).click();
  await architect.getByRole("link", { name: "Reviews" }).first().click();
  await expect(architect.getByTestId("awaiting-me")).toHaveCount(2);
  // can't open workflow admin
  const wfUrl = page.url().replace(/reviews.*$/, "reviews/workflows");
  const denied = await architect.goto(wfUrl);
  expect(denied?.status()).toBe(404);
  await architect.goBack();

  // marks up the drawing: as the active reviewer, a View + Download member can publish
  await architect.getByTestId("review-row").filter({ hasText: "Main lodge plan.pdf V1" }).getByRole("link").first().click();
  await architect.getByRole("link", { name: "Open Main lodge plan.pdf in the viewer" }).click();
  const layer = architect.getByTestId("markup-layer");
  await expect(architect.getByTestId("page-indicator")).toHaveText("Page 1 of 1");
  await architect.getByRole("toolbar", { name: "Markup tools" }).getByRole("button", { name: "Rectangle" }).click();
  await drag(architect, layer, [60, 60], [200, 140]);
  const item = architect.getByTestId("markup-item").first();
  await expect(item).toContainText("Private");
  await item.getByRole("button", { name: "Publish" }).click();
  await expect(item).toContainText("Published");
  await architect.goBack();

  // step 1 decision with a comment
  const decide = architect.getByTestId("decision-form");
  await decide.getByLabel("Status for Main lodge plan.pdf").selectOption({ label: "Approved with comments" });
  await decide.getByLabel("Comment on Main lodge plan.pdf").fill("Widen the deck stair to 1200mm");
  await decide.getByRole("button", { name: "Submit review" }).click();
  // the form goes away once the step is complete
  await expect(architect.getByTestId("review-status")).toContainText("Step 2 of 2: Client sign-off");
  await expect(architect.getByTestId("decision-form")).toHaveCount(0);

  // the other review: Revise and resubmit by the architect
  await architect.getByRole("link", { name: "← Reviews" }).click();
  await architect.getByTestId("review-row").filter({ hasText: "Deck balustrade check" }).getByRole("link").first().click();
  await architect.getByTestId("decision-form").getByLabel("Status for Main lodge plan.pdf").selectOption({ label: "Revise and resubmit" });
  await architect.getByTestId("decision-form").getByRole("button", { name: "Submit review" }).click();
  await expect(architect.getByTestId("review-status")).toContainText("Step 2 of 2");

  // a member who isn't a reviewer can see the review (they can view the folder) but can't decide
  await outsider.getByRole("link", { name: /Delta Tented Camp/ }).click();
  await outsider.getByRole("link", { name: "Reviews" }).first().click();
  await expect(outsider.getByTestId("awaiting-me")).toHaveCount(0);
  await outsider.getByTestId("review-row").filter({ hasText: "Main lodge plan.pdf V1" }).getByRole("link").first().click();
  await expect(outsider.getByTestId("decision-form")).toHaveCount(0);

  // the client approves: the review closes and the file is copied to Approved
  await page.getByRole("link", { name: "← Reviews" }).click();
  await page.getByTestId("review-row").filter({ hasText: "Main lodge plan.pdf V1" }).getByRole("link").first().click();
  const client = page.getByTestId("decision-form");
  await client.getByLabel("Status for Main lodge plan.pdf").selectOption({ label: "Approved" });
  await client.getByRole("button", { name: "Submit review" }).click();
  await expect(page.getByTestId("review-status")).toContainText("Closed");
  await expect(page.getByTestId("file-outcome")).toHaveText("Approved");
  await expect(page.getByTestId("copied-to")).toContainText("Copied to Approved as V1");
  const steps = page.getByTestId("review-step");
  await expect(steps.first()).toContainText("Widen the deck stair to 1200mm");
  await expect(steps.first()).toContainText("Approved with comments");

  // ⭐ export the closed review with its markups
  const href = await page.getByTestId("export-review").getAttribute("href");
  const res = await page.request.get(href!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("application/pdf");
  const pdf = await PDFDocument.load(await res.body());
  expect(pdf.getPageCount()).toBe(2); // summary + the drawing

  // the approved copy is in the Approved folder
  await page.getByTestId("copied-to").getByRole("link", { name: "Approved" }).click();
  await expect(page.getByRole("heading", { name: "Approved", level: 2 })).toBeVisible();
  await expect(page.getByTestId("file-row")).toContainText("Main lodge plan.pdf");

  // ⭐ search reviews by comment text, file name and number; filter by status
  await page.getByRole("link", { name: "Reviews" }).first().click();
  await page.getByLabel("Search reviews").fill("deck stair");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByTestId("review-row")).toHaveCount(1);
  await expect(page.getByTestId("review-row")).toContainText("Main lodge plan.pdf V1");
  await page.getByLabel("Search reviews").fill("zebra");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText("No reviews match your search.")).toBeVisible();
  await page.getByLabel("Search reviews").fill("#2");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByTestId("review-row")).toHaveCount(1);
  await expect(page.getByTestId("review-row")).toContainText("Deck balustrade check");
  await page.getByLabel("Search reviews").fill("");
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("group", { name: "Status" }).getByRole("link", { name: "Closed" }).click();
  await expect(page.getByTestId("review-row")).toHaveCount(1);
  await page.getByRole("group", { name: "Status" }).getByRole("link", { name: "Open" }).click();
  await expect(page.getByTestId("review-row")).toHaveCount(1);
  await expect(page.getByTestId("review-row")).toContainText("Deck balustrade check");

  // an open review can't be exported
  const openHref = (await page.getByTestId("review-row").getByRole("link").first().getAttribute("href"))!;
  const openRes = await page.request.get(`/api${openHref}/export`);
  expect(openRes.status()).toBe(409);
});

test("reviews work at phone width", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 740 } });
  const page = await ctx.newPage();
  const stamp = Date.now();
  await page.goto("/signup");
  await page.getByLabel("Organisation").fill(`Phone Reviews ${stamp}`);
  await page.getByLabel("Your name").fill("Naledi Phone");
  await page.getByLabel("Work email").fill(`phone-rev${stamp}@lodge.test`);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Name").fill("Phone Review Camp");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByRole("link", { name: "Reviews" }).first().click();
  await page.getByRole("navigation", { name: "Reviews" }).getByRole("link", { name: "Workflows" }).click();
  const wf = page.getByTestId("workflow-form");
  await wf.getByLabel("Workflow name").fill("Quick check");
  await wf.getByLabel("Step 1 name").fill("Check");
  await wf.getByLabel("Step 1 reviewers").selectOption({ label: "Naledi Phone" });
  await wf.getByRole("button", { name: "Create workflow" }).click();
  await expect(wf.getByRole("status")).toContainText("Created workflow Quick check");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await ctx.close();
});

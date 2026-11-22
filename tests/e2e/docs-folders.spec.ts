import { expect, test, type Page } from "@playwright/test";

const file = (name: string, text: string, mimeType = "application/pdf") => ({ name, mimeType, buffer: Buffer.from(text) });

async function signUp(page: Page, stamp: number) {
  await page.goto("/signup");
  await page.getByLabel("Organisation").fill(`Baobab Lodges ${stamp}`);
  await page.getByLabel("Your name").fill("Thandi Controller");
  await page.getByLabel("Work email").fill(`docs${stamp}@lodge.test`);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
}

test("folders, multi-file upload, version stacking, history download, sort, views and viewer access", async ({ page, browser }) => {
  const stamp = Date.now();
  await signUp(page, stamp);
  await page.getByLabel("Name").fill("Chobe River Lodge");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { name: "Members" })).toBeVisible();

  // Document Control opens on Plans; both roots exist in the tree
  await page.getByRole("link", { name: "Document Control" }).click();
  await expect(page.getByRole("heading", { name: "Plans", level: 2 })).toBeVisible();
  const tree = page.getByTestId("folder-tree");
  await expect(tree.getByRole("link", { name: "Plans" })).toBeVisible();
  await expect(tree.getByRole("link", { name: "Project Files" })).toBeVisible();
  // roots can't be renamed or deleted
  await expect(page.getByText("Rename", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete folder" })).toHaveCount(0);

  // create a subfolder, rejecting a bad name and a duplicate
  await page.getByText("New folder", { exact: true }).click();
  const newFolder = page.getByTestId("new-folder-form");
  await newFolder.getByLabel("Folder name").fill("Arch/itectural");
  await newFolder.getByRole("button", { name: "Create" }).click();
  await expect(newFolder.getByRole("alert")).toContainText("can't contain");
  await newFolder.getByLabel("Folder name").fill("Architectural");
  await newFolder.getByRole("button", { name: "Create" }).click();
  await expect(newFolder.getByRole("status")).toContainText("Created folder Architectural");
  await newFolder.getByLabel("Folder name").fill("architectural");
  await newFolder.getByRole("button", { name: "Create" }).click();
  await expect(newFolder.getByRole("alert")).toContainText("already exists");

  // open it from the list, then rename it
  await page.getByTestId("folder-row").getByRole("link", { name: "Architectural" }).click();
  await expect(page.getByRole("heading", { name: "Architectural", level: 2 })).toBeVisible();
  await page.getByText("Rename", { exact: true }).click();
  const rename = page.getByTestId("rename-folder-form");
  await rename.getByLabel("New folder name").fill("Architecture");
  await rename.getByRole("button", { name: "Save name" }).click();
  await expect(rename.getByRole("status")).toContainText("Renamed to Architecture");
  await expect(page.getByRole("heading", { name: "Architecture", level: 2 })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Plans/Architecture");

  // upload several files at once, each with a progress bar
  const chooser = page.getByLabel("Choose files to upload");
  await chooser.setInputFiles([
    file("A-101 Ground Floor.pdf", "ground floor v1"),
    file("A-102 Roof Plan.pdf", "roof plan v1 with a much longer body so it is the bigger file".repeat(20)),
    file("Finishes schedule.xlsx", "xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
  ]);
  const uploads = page.getByTestId("upload-list");
  await expect(uploads.getByRole("progressbar")).toHaveCount(3);
  await expect(uploads.getByText("Saved as V1")).toHaveCount(3);
  const rows = page.getByTestId("file-row");
  await expect(rows).toHaveCount(3);

  // same name (different case) stacks as V2
  await chooser.setInputFiles([file("a-101 ground floor.PDF", "ground floor v2 revised")]);
  await expect(uploads.getByText("Saved as V2")).toBeVisible();
  await expect(rows).toHaveCount(3);
  const groundRow = rows.filter({ hasText: "A-101 Ground Floor.pdf" });
  await expect(groundRow.getByRole("button", { name: /Version history/ })).toHaveText("V2");

  // history drawer lists both versions and downloads each
  await groundRow.getByRole("button", { name: /Version history/ }).click();
  const drawer = page.getByRole("dialog", { name: /Version history/ });
  await expect(drawer.getByTestId("version-row")).toHaveCount(2);
  await expect(drawer.getByTestId("version-row").first()).toContainText("Current");
  for (const [label, body] of [["Download V1", "ground floor v1"], ["Download V2", "ground floor v2 revised"]] as const) {
    const href = await drawer.getByRole("link", { name: label }).getAttribute("href");
    const res = await page.request.get(href!);
    expect(res.status()).toBe(200);
    expect(await res.text()).toBe(body);
  }
  const [download] = await Promise.all([page.waitForEvent("download"), drawer.getByRole("link", { name: "Download V1" }).click()]);
  expect(download.suggestedFilename()).toBe("A-101 Ground Floor.pdf");
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);

  // sorting
  const names = () => rows.locator("td:first-child a").allTextContents();
  expect(await names()).toEqual(["A-101 Ground Floor.pdf", "A-102 Roof Plan.pdf", "Finishes schedule.xlsx"]);
  await page.getByRole("group", { name: "Sort by" }).getByRole("link", { name: /Size/ }).click();
  await expect(page).toHaveURL(/sort=size&dir=desc/);
  await expect.poll(names).toEqual(["A-102 Roof Plan.pdf", "A-101 Ground Floor.pdf", "Finishes schedule.xlsx"]);
  await page.getByRole("group", { name: "Sort by" }).getByRole("link", { name: /Name/ }).click();
  await expect(page).toHaveURL(/sort=name&dir=asc/);
  await page.getByRole("group", { name: "Sort by" }).getByRole("link", { name: "Name ↑" }).click();
  await expect(page).toHaveURL(/sort=name&dir=desc/);
  await expect.poll(names).toEqual(["Finishes schedule.xlsx", "A-102 Roof Plan.pdf", "A-101 Ground Floor.pdf"]);
  await page.getByRole("group", { name: "Sort by" }).getByRole("link", { name: /Date/ }).click();
  await expect.poll(async () => (await names())[0]).toBe("A-101 Ground Floor.pdf"); // V2 is the newest change

  // grid view
  await page.getByRole("group", { name: "View" }).getByRole("link", { name: "Grid" }).click();
  await expect(page.getByTestId("file-card")).toHaveCount(3);
  await page.getByRole("group", { name: "View" }).getByRole("link", { name: "List" }).click();
  await expect(rows).toHaveCount(3);

  // nested folder; tree expands and collapses
  await page.getByText("New folder", { exact: true }).click();
  await page.getByTestId("new-folder-form").getByLabel("Folder name").fill("Villas");
  await page.getByTestId("new-folder-form").getByRole("button", { name: "Create" }).click();
  await expect(tree.getByRole("link", { name: "Villas" })).toBeVisible();
  await tree.getByRole("button", { name: "Collapse Architecture" }).click();
  await expect(tree.getByRole("link", { name: "Villas" })).toHaveCount(0);
  await tree.getByRole("button", { name: "Expand Architecture" }).click();
  await expect(tree.getByRole("link", { name: "Villas" })).toBeVisible();

  // delete the nested folder (with confirmation) and land back in its parent
  await tree.getByRole("link", { name: "Villas" }).click();
  await expect(page.getByRole("heading", { name: "Villas", level: 2 })).toBeVisible();
  await page.getByLabel("Choose files to upload").setInputFiles([file("Villa 1 plan.pdf", "villa")]);
  await expect(page.getByTestId("upload-list").getByText("Saved as V1")).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Delete folder" }).click();
  await expect(page.getByRole("heading", { name: "Architecture", level: 2 })).toBeVisible();
  await expect(tree.getByRole("link", { name: "Villas" })).toHaveCount(0);

  // audit trail
  await page.getByRole("link", { name: "Project Admin" }).click();
  await page.getByRole("link", { name: "Activity" }).click();
  for (const a of ["folder.created", "folder.renamed", "folder.deleted", "document.uploaded", "document.version_added"])
    await expect(page.getByRole("cell", { name: a, exact: true }).first()).toBeVisible();

  // a Viewer (DOCS enabled, no grant) can browse and download but not upload or manage
  const viewerEmail = `viewer${stamp}@arch.test`;
  await page.getByRole("link", { name: "Members" }).click();
  const add = page.getByTestId("add-member-form");
  await add.getByLabel("Email").fill(viewerEmail);
  await add.getByLabel("Name").fill("Kagiso Viewer");
  await add.getByRole("button", { name: "Add member" }).click();
  await expect(add.getByRole("status")).toContainText(`Added ${viewerEmail}`);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByTestId("members-table").getByRole("row", { name: /Kagiso Viewer/ }).getByRole("button", { name: "Copy invite link" }).click();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  const ctx = await browser.newContext();
  const viewer = await ctx.newPage();
  await viewer.goto(link);
  await viewer.getByLabel("Password").fill("password456");
  await viewer.getByRole("button", { name: "Join project" }).click();
  await viewer.getByRole("link", { name: /Chobe River Lodge/ }).click();
  await expect(viewer.getByRole("heading", { name: "Plans", level: 2 })).toBeVisible();
  await viewer.getByTestId("folder-tree").getByRole("link", { name: "Architecture" }).click();
  await expect(viewer.getByTestId("file-row")).toHaveCount(3);
  await expect(viewer.getByLabel("Choose files to upload")).toHaveCount(0);
  await expect(viewer.getByText("New folder", { exact: true })).toHaveCount(0);
  await expect(viewer.getByRole("button", { name: "Delete folder" })).toHaveCount(0);
  const href = await viewer.getByTestId("file-row").first().locator("td:first-child a").getAttribute("href");
  expect((await viewer.request.get(href!)).status()).toBe(200);
  await ctx.close();
});

test("document control works at phone width", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 740 } });
  const page = await ctx.newPage();
  const stamp = Date.now();
  await signUp(page, stamp);
  await page.getByLabel("Name").fill("Mobile Camp");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByRole("link", { name: "Document Control" }).click();
  await expect(page.getByRole("heading", { name: "Plans", level: 2 })).toBeVisible();
  // tree is collapsed behind a toggle on phones
  await expect(page.getByTestId("folder-tree")).toBeHidden();
  await page.getByRole("button", { name: "Folders" }).click();
  await page.getByTestId("folder-tree").getByRole("link", { name: "Project Files" }).click();
  await expect(page.getByRole("heading", { name: "Project Files", level: 2 })).toBeVisible();
  await page.getByLabel("Choose files to upload").setInputFiles([file("Site photo.jpg", "jpg", "image/jpeg")]);
  await expect(page.getByTestId("upload-list").getByText("Saved as V1")).toBeVisible();
  await expect(page.getByTestId("file-row")).toHaveCount(1);
  // no horizontal page scroll
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await ctx.close();
});

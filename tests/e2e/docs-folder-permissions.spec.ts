import { expect, test, type Browser, type Page } from "@playwright/test";

const pdf = (name: string, text: string) => ({ name, mimeType: "application/pdf", buffer: Buffer.from(text) });

/** Adds a member (Document Control + Issues, Viewer by default) and returns a signed-in page for them. */
async function inviteAndJoin(admin: Page, browser: Browser, email: string, name: string, company?: string) {
  await admin.getByRole("link", { name: "Project Admin" }).click();
  await admin.getByRole("link", { name: "Members" }).click();
  const add = admin.getByTestId("add-member-form");
  await add.getByLabel("Email").fill(email);
  await add.getByLabel("Name").fill(name);
  if (company) await add.getByLabel("Company").selectOption({ label: company });
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

test("private folders, inherited grants, overrides and server-side enforcement", async ({ page, browser }) => {
  const stamp = Date.now();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/signup");
  await page.getByLabel("Organisation").fill(`Marula Estates ${stamp}`);
  await page.getByLabel("Your name").fill("Ayanda Admin");
  await page.getByLabel("Work email").fill(`perm${stamp}@estate.test`);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Name").fill("Lake Kariba Houseboats");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { name: "Members" })).toBeVisible();

  // the QS company
  await page.getByRole("link", { name: "Companies" }).click();
  await expect(page.getByRole("heading", { name: "Companies" })).toBeVisible();
  await page.getByLabel("Name").fill("Baobab QS");
  await page.getByRole("button", { name: "Add company" }).click();
  await expect(page.getByRole("cell", { name: "Baobab QS" })).toBeVisible();

  // Commercial folder under Project Files, with a file and a subfolder
  await page.getByRole("link", { name: "Document Control" }).click();
  const tree = page.getByTestId("folder-tree");
  await tree.getByRole("link", { name: "Project Files" }).click();
  await expect(page.getByRole("heading", { name: "Project Files", level: 2 })).toBeVisible();
  await page.getByText("New folder", { exact: true }).click();
  await page.getByTestId("new-folder-form").getByLabel("Folder name").fill("Commercial");
  await page.getByTestId("new-folder-form").getByRole("button", { name: "Create" }).click();
  await tree.getByRole("link", { name: "Commercial" }).click();
  await expect(page.getByRole("heading", { name: "Commercial", level: 2 })).toBeVisible();
  await page.getByLabel("Choose files to upload").setInputFiles([pdf("Valuation 03.pdf", "valuation three")]);
  await expect(page.getByTestId("upload-list").getByText("Saved as V1")).toBeVisible();
  await page.getByText("New folder", { exact: true }).click();
  await page.getByTestId("new-folder-form").getByLabel("Folder name").fill("Valuations");
  await page.getByTestId("new-folder-form").getByRole("button", { name: "Create" }).click();
  await expect(tree.getByRole("link", { name: "Valuations" })).toBeVisible();
  const commercialUrl = page.url().split("?")[0];
  const downloadHref = await page.getByTestId("file-row").locator("td:first-child a").getAttribute("href");

  // make Commercial private: members No access, Baobab QS View
  const perms = page.getByTestId("folder-permissions");
  await perms.getByText(/Permissions/).first().click();
  const grant = page.getByTestId("folder-grant-form");
  await grant.getByLabel("Grant to").selectOption({ label: "Project members (default)" });
  await grant.getByLabel("Level").selectOption("NONE");
  await grant.getByRole("button", { name: "Save" }).click();
  await expect(grant.getByRole("status")).toContainText("Saved: No access");
  await grant.getByLabel("Grant to").selectOption({ label: "Baobab QS" });
  await grant.getByLabel("Level").selectOption("VIEW");
  await grant.getByRole("button", { name: "Save" }).click();
  await expect(grant.getByRole("status")).toContainText("Saved: View");
  const access = page.getByTestId("access-table");
  await expect(access.getByRole("row", { name: /Project members \(default\)/ })).toContainText("No access");
  await expect(access.getByRole("row", { name: /Baobab QS/ })).toContainText("Set here");

  // two Viewers: one in Baobab QS, one not
  const qs = await inviteAndJoin(page, browser, `qs${stamp}@baobab.test`, "Rudo QS", "Baobab QS");
  const other = await inviteAndJoin(page, browser, `mep${stamp}@lowveld.test`, "Musa MEP");

  // QS member: sees Commercial and the file, but View only (no download)
  await qs.getByRole("link", { name: /Lake Kariba Houseboats/ }).click();
  await expect(qs.getByRole("heading", { name: "Plans", level: 2 })).toBeVisible();
  await qs.getByTestId("folder-tree").getByRole("link", { name: "Commercial" }).click();
  await expect(qs.getByTestId("my-access")).toHaveText("Your access: View");
  await expect(qs.getByTestId("file-row")).toContainText("Valuation 03.pdf");
  await expect(qs.getByTestId("file-row").locator("a")).toHaveCount(0);
  await expect(qs.getByLabel("Choose files to upload")).toHaveCount(0);
  await expect(qs.getByTestId("folder-permissions")).toHaveCount(0);
  expect((await qs.request.get(downloadHref!, { maxRedirects: 0 })).status()).toBe(403);
  // inherited by the subfolder
  await qs.getByTestId("folder-tree").getByRole("link", { name: "Valuations" }).click();
  await expect(qs.getByTestId("my-access")).toHaveText("Your access: View");

  // the other member can't see Commercial at all, nor open it by URL
  await other.getByRole("link", { name: /Lake Kariba Houseboats/ }).click();
  await expect(other.getByRole("heading", { name: "Plans", level: 2 })).toBeVisible();
  await expect(other.getByTestId("folder-tree").getByRole("link", { name: "Project Files" })).toBeVisible();
  await expect(other.getByTestId("folder-tree").getByText("Commercial")).toHaveCount(0);
  expect((await other.goto(commercialUrl))!.status()).toBe(404);
  expect((await other.request.get(downloadHref!, { maxRedirects: 0 })).status()).toBe(403);

  // raise Baobab QS to Upload: they can upload but not create folders, rename, delete or manage
  await page.goto(commercialUrl);
  await page.getByTestId("folder-permissions").getByText(/Permissions/).first().click();
  await grant.getByLabel("Grant to").selectOption({ label: "Baobab QS" });
  await grant.getByLabel("Level").selectOption("UPLOAD");
  await grant.getByRole("button", { name: "Save" }).click();
  await expect(grant.getByRole("status")).toContainText("Saved: Upload");
  await page.getByText(/Check each member/).click();
  await expect(page.getByTestId("member-access").getByRole("listitem").filter({ hasText: "Rudo QS" })).toContainText("Upload");
  await expect(page.getByTestId("member-access").getByRole("listitem").filter({ hasText: "Musa MEP" })).toContainText("No access");

  await qs.goto(commercialUrl);
  await expect(qs.getByTestId("my-access")).toHaveText("Your access: Upload");
  await qs.getByLabel("Choose files to upload").setInputFiles([pdf("Valuation 04.pdf", "valuation four")]);
  await expect(qs.getByTestId("upload-list").getByText("Saved as V1")).toBeVisible();
  await expect(qs.getByTestId("file-row")).toHaveCount(2);
  await expect(qs.getByTestId("file-row").first().locator("a")).toHaveCount(1); // Upload includes download
  await expect(qs.getByText("New folder", { exact: true })).toHaveCount(0);
  await expect(qs.getByRole("button", { name: "Delete folder" })).toHaveCount(0);
  await expect(qs.getByText("Rename", { exact: true })).toHaveCount(0);

  // override on the subfolder: Baobab QS only View there; shown as set here vs inherited
  await page.getByTestId("folder-tree").getByRole("link", { name: "Valuations" }).click();
  await expect(page.getByRole("heading", { name: "Valuations", level: 2 })).toBeVisible();
  await page.getByTestId("folder-permissions").getByText(/Permissions/).first().click();
  await expect(page.getByTestId("access-table").getByRole("row", { name: /Baobab QS/ })).toContainText("Inherited from Commercial");
  await grant.getByLabel("Grant to").selectOption({ label: "Baobab QS" });
  await grant.getByLabel("Level").selectOption("VIEW");
  await grant.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("access-table").getByRole("row", { name: /Baobab QS/ })).toContainText("Set here");
  await qs.getByTestId("folder-tree").getByRole("link", { name: "Valuations" }).click();
  await expect(qs.getByTestId("my-access")).toHaveText("Your access: View");

  // removing the override falls back to the inherited Upload
  await page.getByTestId("access-table").getByRole("button", { name: "Remove grant for Baobab QS" }).click();
  await expect(page.getByTestId("access-table").getByRole("row", { name: /Baobab QS/ })).toContainText("Inherited from Commercial");
  await qs.reload();
  await expect(qs.getByTestId("my-access")).toHaveText("Your access: Upload");

  // the Permissions panel fits a phone screen without sideways scrolling
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(commercialUrl);
  await page.getByTestId("folder-permissions").getByText(/Permissions/).first().click();
  await page.getByText(/Check each member/).click();
  await expect(page.getByTestId("access-table")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 1280, height: 800 });

  // audit trail
  await page.getByRole("link", { name: "Project Admin" }).click();
  await page.getByRole("link", { name: "Activity" }).click();
  for (const a of ["folder.permission_set", "folder.permission_removed"])
    await expect(page.getByRole("cell", { name: a, exact: true }).first()).toBeVisible();

  await qs.context().close();
  await other.context().close();
});

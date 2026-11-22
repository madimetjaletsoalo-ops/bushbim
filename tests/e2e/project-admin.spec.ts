import { expect, test } from "@playwright/test";

// Full Project Admin journey for a brand-new organisation.
test("sign up, create projects, add members, add to many projects, grant permissions, accept invite", async ({ page, browser }) => {
  const stamp = Date.now();
  const adminEmail = `owner${stamp}@lodge.test`;
  const guestEmail = `guest${stamp}@thatch.test`;

  await page.goto("/signup");
  await page.getByLabel("Organisation").fill(`Acacia Resorts ${stamp}`);
  await page.getByLabel("Your name").fill("Lerato Owner");
  await page.getByLabel("Work email").fill(adminEmail);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

  // three projects
  for (const name of ["Okavango Camp", "Serengeti Villas", "Cape Winelands Spa"]) {
    await page.goto("/projects");
    await page.getByLabel("Name").fill(name);
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page.getByRole("heading", { name: "Members" })).toBeVisible();
  }

  // company + role
  await page.getByRole("link", { name: "Companies" }).click();
  await expect(page.getByRole("heading", { name: "Companies" })).toBeVisible();
  await page.getByLabel("Name").fill("Mopane Thatchers");
  await page.getByLabel("Trade").fill("Thatching");
  await page.getByRole("button", { name: "Add company" }).click();
  await expect(page.getByRole("cell", { name: "Mopane Thatchers" })).toBeVisible();
  await page.getByRole("link", { name: "Roles" }).click();
  await expect(page.getByRole("heading", { name: "Roles" })).toBeVisible();
  await page.getByLabel("Name").fill("Subcontractor");
  await page.getByRole("button", { name: "Add role" }).click();
  await expect(page.getByRole("cell", { name: "Subcontractor" })).toBeVisible();

  // add to all three projects at once
  await page.goto("/account/add-to-projects");
  const form = page.getByTestId("multi-project-form");
  await form.getByLabel("Email").fill(guestEmail);
  await form.getByLabel("Name").fill("Bongani Guest");
  for (const name of ["Okavango Camp", "Serengeti Villas", "Cape Winelands Spa"]) await form.getByLabel(name).check();
  await form.getByLabel("Company").selectOption({ label: "Mopane Thatchers" });
  await form.getByLabel("Role").selectOption({ label: "Subcontractor" });
  await form.getByRole("button", { name: "Add to selected projects" }).click();
  await expect(page.getByRole("status")).toContainText("3 project(s)");

  // shows on each project's members list as invited
  await page.goto("/projects");
  for (const name of ["Okavango Camp", "Serengeti Villas", "Cape Winelands Spa"]) {
    await page.goto("/projects");
    await page.getByRole("link", { name: new RegExp(name) }).click();
    await page.getByRole("link", { name: "Project Admin" }).click();
    const row = page.getByTestId("members-table").getByRole("row", { name: /Bongani Guest/ });
    await expect(row).toContainText("Mopane Thatchers");
    await expect(row).toContainText("Invited");
  }

  // grant the company Manager on Issues; effective table reflects it
  await page.getByRole("link", { name: "Services" }).click();
  await expect(page.getByRole("heading", { name: /Services/ })).toBeVisible();
  const grant = page.getByTestId("grant-form");
  await grant.getByLabel("Service").selectOption("ISSUES");
  await grant.getByLabel("Grant to").selectOption({ label: "Mopane Thatchers" });
  await grant.getByLabel("Level").selectOption("MANAGER");
  await grant.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toContainText("Permission saved");
  const eff = page.getByTestId("effective-table").getByRole("row", { name: /Bongani Guest/ });
  await expect(eff.getByRole("cell").nth(2)).toHaveText("MANAGER"); // Issues column
  await expect(eff.getByRole("cell").nth(3)).toHaveText("NONE"); // Checklists not enabled

  // CSV bulk invite with a duplicate
  await page.getByRole("link", { name: "Members" }).click();
  await expect(page.getByRole("heading", { name: "Members" })).toBeVisible();
  await page.getByLabel("CSV rows").fill(`email,name,company,role,access\nzola${stamp}@mep.test,Zola MEP,Lowveld MEP,Engineer,member\nZOLA${stamp}@mep.test,Dup,,,\n`);
  await page.getByRole("button", { name: "Import" }).click();
  await expect(page.getByRole("status")).toContainText("1 added");
  await expect(page.getByText(/Duplicate email/)).toBeVisible();

  // accept invite in a fresh browser context
  const editRow = page.getByTestId("members-table").getByRole("row", { name: /Bongani Guest/ });
  await expect(editRow.getByRole("button", { name: "Copy invite link" })).toBeVisible();
  const ctx = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await editRow.getByRole("button", { name: "Copy invite link" }).click();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toContain("/invite/");
  const guest = await ctx.newPage();
  await guest.goto(link);
  await guest.getByLabel("Password").fill("password456");
  await guest.getByRole("button", { name: "Join project" }).click();
  await expect(guest.getByRole("heading", { name: "Projects" })).toBeVisible();
  await expect(guest.getByRole("link", { name: /Okavango Camp/ })).toBeVisible();
  await expect(guest.getByRole("link", { name: /Serengeti Villas/ })).toBeVisible();
  // guest is not admin: no Project Admin module, no create-project form
  await expect(guest.getByRole("button", { name: "Create project" })).toHaveCount(0);
  await guest.getByRole("link", { name: /Okavango Camp/ }).click();
  await expect(guest.getByRole("link", { name: "Project Admin" })).toHaveCount(0);
  await ctx.close();
});

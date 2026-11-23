import { expect, test, type Browser, type Page } from "@playwright/test";

async function signUpWithProject(page: Page, stamp: number, project: string) {
  await page.goto("/signup");
  await page.getByLabel("Organisation").fill(`Kruger Lodges ${stamp}`);
  await page.getByLabel("Your name").fill("Naledi Manager");
  await page.getByLabel("Work email").fill(`iss${stamp}@kruger.test`);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Name").fill(project);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { name: "Members" })).toBeVisible();
}

/** Adds a member (Document Control + Issues Viewer by default) and returns a signed-in page for them. */
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

test("issues: custom statuses, configuration, create, Creator rules, assignee status, filters and CSV", async ({ page, browser }) => {
  const stamp = Date.now();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await signUpWithProject(page, stamp, "Sabi Sand Villas");
  const thandi = await inviteAndJoin(page, browser, `thandi${stamp}@kruger.test`, "Thandi Finisher");
  const sipho = await inviteAndJoin(page, browser, `sipho${stamp}@kruger.test`, "Sipho Contractor");

  // Sipho becomes an Issues Creator
  await page.getByRole("link", { name: "Services" }).click();
  const grant = page.getByTestId("grant-form");
  await grant.getByLabel("Service").selectOption("ISSUES");
  await grant.getByLabel("Grant to").selectOption({ label: "Sipho Contractor" });
  await grant.getByLabel("Level").selectOption("CREATOR");
  await grant.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toContainText("Permission saved");

  // ⭐ settings: the default statuses, a renamed one, a sub-status, an attribute and locations
  await page.getByRole("link", { name: "Issues", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Issues", exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Issues" }).getByRole("link", { name: "Settings" }).click();
  const rows = page.getByTestId("status-row");
  await expect(rows).toHaveCount(9);
  await expect(page.getByLabel("Name of Draft")).toHaveValue("Draft");
  await expect(page.getByLabel("Name of Void")).toHaveValue("Void");
  const answered = rows.filter({ has: page.getByLabel("Name of Answered") });
  await page.getByLabel("Name of Answered").fill("Responded");
  await answered.getByRole("button", { name: "Save" }).click();
  await expect(page.getByLabel("Name of Responded")).toBeVisible();
  const addStatus = page.getByTestId("add-status-form");
  await addStatus.getByLabel("New status").fill("Awaiting subcontractor");
  await addStatus.getByLabel("Sub-status of").selectOption({ label: "Open" });
  await addStatus.getByRole("button", { name: "Add status" }).click();
  await expect(addStatus.getByRole("status")).toContainText("Added status Awaiting subcontractor");
  await expect(rows).toHaveCount(10);
  // duplicates are refused
  await addStatus.getByLabel("New status").fill("closed");
  await addStatus.getByRole("button", { name: "Add status" }).click();
  await expect(addStatus.getByRole("alert")).toContainText('already a status called "closed"');

  const attr = page.getByTestId("add-attribute-form");
  await attr.getByLabel("Attribute name").fill("Trade");
  await attr.getByLabel("Kind").selectOption("LIST");
  await attr.getByLabel("List options").fill("Thatching, Joinery, Pools");
  await attr.getByRole("button", { name: "Add attribute" }).click();
  await expect(attr.getByRole("status")).toContainText("Added Trade");

  const loc = page.getByTestId("add-location-form");
  await loc.getByLabel("Location name").fill("North camp");
  await loc.getByRole("button", { name: "Add location" }).click();
  await expect(loc.getByRole("status")).toContainText("Added North camp");
  await loc.getByLabel("Location name").fill("Villa 3");
  await loc.getByLabel("Inside").selectOption({ label: "North camp" });
  await loc.getByRole("button", { name: "Add location" }).click();
  await expect(loc.getByRole("status")).toContainText("Added Villa 3");

  // the manager raises #1, assigned to Thandi, overdue, in Villa 3
  await page.getByRole("navigation", { name: "Issues" }).getByRole("link", { name: "New issue" }).click();
  const form = page.getByTestId("issue-form");
  await form.getByLabel("Title").fill("Cracked basin in master bathroom");
  await form.getByLabel("Description").fill("Hairline crack across the stone basin.");
  await form.getByLabel("Type", { exact: true }).selectOption({ label: "Quality" });
  await form.getByLabel("Subtype").selectOption({ label: "Snag (luxury finishes)" });
  await form.getByLabel("Assigned to").selectOption({ label: "Thandi Finisher" });
  await form.getByLabel("Due date").fill("2026-01-15");
  await form.getByLabel("Location").selectOption({ label: "North camp › Villa 3" });
  await form.getByLabel("Root cause").selectOption({ label: "Workmanship" });
  await form.getByLabel("Trade").selectOption("Joinery");
  await form.getByLabel("Watcher Thandi Finisher").check();
  await form.getByRole("button", { name: "Create issue" }).click();
  await expect(page.getByRole("heading", { name: /#1 Cracked basin/ })).toBeVisible();
  await expect(page.getByTestId("issue-status")).toHaveText("Open");
  await expect(page.getByTestId("watchers")).toContainText("Naledi Manager");
  await expect(page.getByTestId("watchers")).toContainText("Thandi Finisher");
  // the manager corrects the trade
  const edit = page.getByTestId("edit-issue-form");
  await edit.getByLabel("Trade").selectOption("Thatching");
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(edit.getByRole("status")).toContainText("Issue saved");
  await expect(page.getByTestId("issue-activity")).toContainText("edited custom attributes");

  // #2 is a draft safety issue
  await page.getByRole("navigation", { name: "Issues" }).getByRole("link", { name: "New issue" }).click();
  await form.getByLabel("Title").fill("Loose balustrade on deck");
  await form.getByLabel("Type", { exact: true }).selectOption({ label: "Safety" });
  await form.getByLabel("Status").selectOption({ label: "Draft" });
  await form.getByRole("button", { name: "Create issue" }).click();
  await expect(page.getByRole("heading", { name: /#2 Loose balustrade/ })).toBeVisible();

  // Sipho (Creator) can't see the draft, raises #3 and edits only his own
  await sipho.getByRole("link", { name: /Sabi Sand Villas/ }).click();
  await sipho.getByRole("link", { name: "Issues", exact: true }).click();
  await expect(sipho.getByTestId("issue-row")).toHaveCount(1);
  await sipho.getByRole("link", { name: "New issue" }).first().click();
  const sForm = sipho.getByTestId("issue-form");
  await sForm.getByLabel("Title").fill("Thatch ridge not capped");
  await sForm.getByLabel("Type", { exact: true }).selectOption({ label: "Quality" });
  await sForm.getByLabel("Location").selectOption({ label: "North camp" });
  await sForm.getByRole("button", { name: "Create issue" }).click();
  await expect(sipho.getByRole("heading", { name: /#3 Thatch ridge/ })).toBeVisible();
  await expect(sipho.getByTestId("edit-issue-form")).toBeVisible();
  await sipho.getByRole("link", { name: "← Issues" }).click();
  await sipho.getByTestId("issue-row").filter({ hasText: "Cracked basin" }).getByRole("link").click();
  await expect(sipho.getByTestId("issue-readonly")).toContainText("Creators can edit only the issues they created.");
  await expect(sipho.getByTestId("edit-issue-form")).toHaveCount(0);
  await expect(sipho.getByTestId("status-form")).toHaveCount(0);
  // anyone who can see an issue can comment
  await sipho.getByLabel("Add a comment").fill("Basin supplier contacted.");
  await sipho.getByRole("button", { name: "Post comment" }).click();
  await expect(sipho.getByTestId("comment")).toContainText("Basin supplier contacted.");

  // Thandi (Viewer, the assignee) moves #1 to the sub-status with a comment, but can't edit or create
  await thandi.getByRole("link", { name: /Sabi Sand Villas/ }).click();
  await thandi.getByRole("link", { name: "Issues", exact: true }).click();
  await expect(thandi.getByRole("link", { name: "New issue" })).toHaveCount(0);
  await thandi.getByTestId("issue-row").filter({ hasText: "Cracked basin" }).getByRole("link").click();
  await expect(thandi.getByTestId("issue-readonly")).toContainText("Thatching");
  await expect(thandi.getByTestId("issue-readonly")).toContainText("(overdue)");
  const status = thandi.getByTestId("status-form");
  await status.getByLabel("Status", { exact: true }).selectOption({ label: "Open › Awaiting subcontractor" });
  await status.getByLabel("Comment (optional)").fill("Stone mason booked for Friday.");
  await status.getByRole("button", { name: "Update status" }).click();
  await expect(status.getByRole("status")).toContainText("Status changed to Awaiting subcontractor");
  await expect(thandi.getByTestId("issue-status")).toHaveText("Open › Awaiting subcontractor");
  await expect(thandi.getByTestId("comment")).toHaveCount(2);
  await expect(thandi.getByTestId("issue-activity")).toContainText("changed the status from Open to Awaiting subcontractor");
  await thandi.goto(thandi.url().replace(/issues\/.*$/, "issues/new"));
  await expect(thandi.getByTestId("cannot-create")).toBeVisible();

  // the manager's table: coloured status bars, overdue, all three issues
  await page.getByRole("navigation", { name: "Issues" }).getByRole("link", { name: "All issues" }).click();
  const table = page.getByTestId("issues-table");
  await expect(page.getByTestId("issue-row")).toHaveCount(3);
  const first = page.getByTestId("issue-row").filter({ hasText: "Cracked basin" });
  await expect(first).toContainText("#1");
  await expect(first).toContainText("Quality › Snag (luxury finishes)");
  await expect(first).toContainText("Overdue");
  await expect(first.getByTestId("status-bar")).toHaveCSS("background-color", "rgb(13, 148, 136)"); // the sub-status colour
  await expect(table.getByTestId("issue-row").filter({ hasText: "Loose balustrade" }).getByTestId("status-bar")).toHaveCSS("background-color", "rgb(156, 163, 175)");

  // filters: status Open includes its sub-status
  const panel = page.getByTestId("filter-panel");
  const apply = async () => {
    await panel.getByRole("button", { name: "Apply filters" }).click();
    await page.waitForURL(/\?/);
  };
  await panel.locator("summary").click();
  await panel.getByLabel("Status Open", { exact: true }).check();
  await apply();
  await expect(page.getByTestId("issue-row")).toHaveCount(2);
  await expect(page.getByTestId("issue-count")).toHaveText("2 issues");
  // add type Quality + custom attribute Trade = Thatching
  await panel.getByLabel("Trade").selectOption("Thatching");
  await panel.getByLabel("Type Quality").check();
  await apply();
  await expect(page.getByTestId("issue-row")).toHaveCount(1);
  await expect(page.getByTestId("issue-row")).toContainText("Cracked basin");

  // CSV export honours the filters
  const exportHref = await page.getByTestId("export-csv").getAttribute("href");
  expect(exportHref).toContain("status=");
  const csv = await (await page.request.get(exportHref!)).text();
  const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
  expect(lines[0]).toBe("ID,Title,Type,Subtype,Status,Assignee,Due date,Location,Root cause,Created by,Created,Description,Trade");
  expect(lines).toHaveLength(2);
  expect(lines[1]).toContain("#1,Cracked basin in master bathroom,Quality,Snag (luxury finishes),Open › Awaiting subcontractor,Thandi Finisher,2026-01-15,North camp › Villa 3,Workmanship,Naledi Manager");
  expect(lines[1]).toMatch(/,Thatching$/);

  // created by + assignee filters, and clear
  await panel.getByRole("link", { name: "Clear" }).click();
  await expect(page.getByTestId("issue-row")).toHaveCount(3);
  await panel.locator("summary").click();
  await panel.getByLabel("Created by").selectOption({ label: "Sipho Contractor" });
  await apply();
  await expect(page.getByTestId("issue-row")).toHaveCount(1);
  await expect(page.getByTestId("issue-row")).toContainText("Thatch ridge");
  await panel.getByLabel("Created by").selectOption("");
  await panel.getByLabel("Assigned to").selectOption({ label: "Thandi Finisher" });
  await apply();
  await expect(page.getByTestId("issue-row")).toHaveCount(1);
  await expect(page.getByTestId("issue-row")).toContainText("Cracked basin");
  // search by ID
  await page.getByLabel("Search issues").fill("#3");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByTestId("issue-row")).toHaveCount(1);
  await expect(page.getByTestId("issue-row")).toContainText("Thatch ridge");

  // a full unfiltered export, from a Creator, leaves out the draft
  const all = await (await sipho.request.get(`/api/projects/${page.url().split("/projects/")[1].split("/")[0]}/issues/export`)).text();
  expect(all).toContain("Thatch ridge");
  expect(all).not.toContain("Loose balustrade");

  // the activity log has the issue events
  await page.getByRole("link", { name: "Project Admin" }).click();
  await page.getByRole("link", { name: "Activity" }).click();
  await expect(page.getByText("issue.created")).toHaveCount(3);
  await expect(page.getByText("issue.status_changed")).toHaveCount(1);
  await expect(page.getByText("issue_status.created")).toHaveCount(1);
});

test("issues work at phone width", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 740 } });
  const page = await ctx.newPage();
  const stamp = Date.now();
  await signUpWithProject(page, stamp, "Phone Issues Camp");
  await page.getByRole("link", { name: "Issues", exact: true }).click();
  await page.getByRole("link", { name: "New issue" }).first().click();
  const form = page.getByTestId("issue-form");
  await form.getByLabel("Title").fill("Pool tiles lifting at the step with a long description title");
  await form.getByLabel("Due date").fill("2030-01-01");
  const noOverflow = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await noOverflow();
  await form.getByRole("button", { name: "Create issue" }).click();
  await expect(page.getByRole("heading", { name: /#1 Pool tiles/ })).toBeVisible();
  await noOverflow();
  await page.getByRole("link", { name: "← Issues" }).click();
  await expect(page.getByTestId("issue-row")).toHaveCount(1);
  await page.getByTestId("filter-panel").locator("summary").click();
  await noOverflow();
  await page.goto(page.url() + "/settings");
  await expect(page.getByRole("heading", { name: "Issues settings" })).toBeVisible();
  await noOverflow();
  await ctx.close();
});

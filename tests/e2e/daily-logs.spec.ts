import { expect, test, type Browser, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { jpegSize } from "../../src/modules/issues/media";

// The web server runs with OPEN_METEO_URL pointing at tests/e2e/mock-open-meteo.mjs,
// which always reports partly cloudy, 18.2–29.6 °C, 0.4 mm rain, wind 14.3 km/h.

async function signUpWithProject(page: Page, stamp: number, project: string) {
  await page.goto("/signup");
  await page.getByLabel("Organisation").fill(`Sabi Lodges ${stamp}`);
  await page.getByLabel("Your name").fill("Thandi Site Manager");
  await page.getByLabel("Work email").fill(`log${stamp}@sabi.test`);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Name").fill(project);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { name: "Members" })).toBeVisible();
}

/** Adds a member of `company` with Daily Logs (Viewer) and returns a signed-in page for them. */
async function inviteAndJoin(admin: Page, browser: Browser, email: string, name: string, company: string) {
  const add = admin.getByTestId("add-member-form");
  await add.getByLabel("Email").fill(email);
  await add.getByLabel("Name").fill(name);
  await add.getByLabel("Company").selectOption({ label: company });
  await add.getByLabel("Daily Logs").check();
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

/** A large PNG drawn in the browser, like an uncompressed phone photo. */
async function bigPng(page: Page, w: number, h: number) {
  const b64 = await page.evaluate(
    async ([w, h]) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const g = c.getContext("2d")!;
      g.fillStyle = "#8a6d3b";
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

test("daily logs: settings, auto weather, labour, subcontractor section, mandatory work log, publish/reopen, photos and PDF", async ({ page, browser }) => {
  const stamp = Date.now();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await signUpWithProject(page, stamp, "Sabi Sand Villas");
  const projectUrl = page.url().replace(/\/admin.*$/, "");

  // a subcontractor company and one of its people (Viewer on Daily Logs)
  await page.goto(`${projectUrl}/admin/companies`);
  await page.getByLabel("Name").fill("Mopane Thatchers");
  await page.getByLabel("Trade").fill("Thatching");
  await page.getByRole("button", { name: "Add company" }).click();
  await expect(page.getByRole("cell", { name: "Mopane Thatchers" })).toBeVisible();
  await page.goto(`${projectUrl}/admin/members`);
  const sipho = await inviteAndJoin(page, browser, `sipho${stamp}@mopane.test`, "Sipho Thatcher", "Mopane Thatchers");

  // settings: coordinates, mandatory work log, a custom checklist item on the template
  await page.goto(projectUrl);
  await page.getByRole("navigation", { name: "Modules" }).getByRole("link", { name: "Daily Logs" }).click();
  await expect(page.getByRole("heading", { name: "Daily Logs" })).toBeVisible();
  await page.getByRole("navigation", { name: "Daily Logs" }).getByRole("link", { name: "Settings" }).click();
  const settings = page.getByTestId("log-settings-form");
  await settings.getByLabel("Latitude").fill("-24.85");
  await settings.getByLabel("Longitude").fill("31.5");
  await settings.getByLabel(/Make the work log mandatory/).check();
  await settings.getByRole("button", { name: "Save settings" }).click();
  await expect(settings.getByRole("status")).toContainText("Settings saved");
  const addItem = page.getByTestId("add-template-item-form");
  await addItem.getByLabel("Item").fill("Toolbox talk held");
  await addItem.getByLabel(/Required before publishing/).check();
  await addItem.getByRole("button", { name: "Add item" }).click();
  await expect(addItem.getByRole("status")).toContainText("Item added");
  await addItem.getByLabel("Item").fill("Gate locked at close");
  await addItem.getByRole("button", { name: "Add item" }).click();
  await expect(page.getByTestId("template-item")).toHaveCount(2);
  await page.getByRole("button", { name: "Move Gate locked at close up" }).click();
  await expect(page.getByTestId("template-item").first()).toContainText("Gate locked at close");

  // today's log starts with the weather from Open-Meteo
  await page.getByRole("navigation", { name: "Daily Logs" }).getByRole("link", { name: "All logs" }).click();
  await page.getByTestId("start-today-form").getByRole("button", { name: "Start today's log" }).click();
  await expect(page.getByTestId("log-status")).toHaveText("Draft");
  const logUrl = page.url();
  const day = logUrl.split("/").pop()!;
  expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await expect(page.getByTestId("weather-summary")).toContainText("Partly cloudy, 18.2–29.6 °C, 0.4 mm rain, wind 14.3 km/h");
  await expect(page.getByTestId("weather-source")).toContainText("Open-Meteo");
  await expect(page.getByTestId("log-item")).toHaveCount(2);

  // the weather can be corrected on site
  await page.getByText("Edit weather").click();
  const weather = page.getByTestId("weather-form");
  await weather.getByLabel("Conditions").fill("Thunderstorm");
  await weather.getByLabel("Rain (mm)").fill("18");
  await weather.getByLabel(/Weather note/).fill("Storm stopped roof work 14:00–15:30");
  await weather.getByRole("button", { name: "Save weather" }).click();
  await expect(weather.getByRole("status")).toContainText("Weather saved");
  await expect(page.getByTestId("weather-summary")).toContainText("Thunderstorm, 18.2–29.6 °C, 18 mm rain");
  await expect(page.getByTestId("weather-source")).toContainText("Entered on site");

  // labour for a crew without a company, equipment and a visitor
  const labour = page.getByTestId("add-labour-form");
  await labour.getByLabel("Company").selectOption({ label: "Other crew (type a name)" });
  await labour.getByLabel(/Crew name/).fill("Local builders");
  await labour.getByLabel("Trade").fill("Masonry");
  await labour.getByLabel("Headcount").fill("12");
  await labour.getByLabel("Hours each").fill("8");
  await labour.getByRole("button", { name: "Add labour" }).click();
  await expect(labour.getByRole("status")).toContainText("Added Local builders");
  await expect(page.getByTestId("labour-total")).toHaveText("12 people · 96 man-hours");

  const eq = page.getByTestId("add-equipment-form");
  await eq.getByLabel("Equipment").fill("TLB");
  await eq.getByLabel("Hours used").fill("6");
  await eq.getByRole("button", { name: "Add equipment" }).click();
  await expect(page.getByTestId("equipment-row")).toContainText("TLB × 1 · 6 h");

  const visitor = page.getByTestId("add-visitor-form");
  await visitor.getByLabel("Visitor name").fill("Dr Lindiwe Mokoena");
  await visitor.getByLabel("Organisation").fill("SANParks");
  await visitor.getByLabel("Arrived").fill("09:00");
  await visitor.getByLabel("Left").fill("08:00");
  await visitor.getByRole("button", { name: "Add visitor" }).click();
  await expect(visitor.getByRole("alert")).toContainText("can't leave before arriving");
  await visitor.getByLabel("Visitor name").fill("Dr Lindiwe Mokoena");
  await visitor.getByLabel("Organisation").fill("SANParks");
  await visitor.getByLabel("Arrived").fill("09:00");
  await visitor.getByLabel("Left").fill("11:30");
  await visitor.getByRole("button", { name: "Add visitor" }).click();
  await expect(page.getByTestId("visitor-row")).toContainText("Dr Lindiwe Mokoena · SANParks · 09:00–11:30");

  // publishing is blocked by the mandatory work log and the required item
  await expect(page.getByTestId("work-log-required")).toBeVisible();
  await page.getByTestId("publish-form").getByRole("button", { name: "Publish log" }).click();
  const blocked = page.getByTestId("publish-form");
  await expect(blocked.getByRole("alert")).toContainText("can't be published yet");
  await expect(blocked).toContainText("The work log is mandatory");
  await expect(blocked).toContainText('Answer the required item "Toolbox talk held"');

  // the subcontractor adds their own company's labour and work, and a photo
  await sipho.goto(logUrl);
  await expect(sipho.getByTestId("log-status")).toHaveText("Draft");
  await expect(sipho.getByTestId("publish-form")).toHaveCount(0);
  await expect(sipho.getByTestId("work-form")).toHaveCount(0);
  await expect(sipho.getByTestId("add-equipment-form")).toHaveCount(0);
  const subForm = sipho.getByTestId("add-labour-form");
  await expect(subForm.getByTestId("own-company")).toHaveText("Mopane Thatchers");
  await subForm.getByLabel("Headcount").fill("6");
  await subForm.getByLabel("Hours each").fill("7.5");
  await subForm.getByLabel("Work carried out").fill("Thatched the north slope of villa 3");
  await subForm.getByRole("button", { name: "Add labour" }).click();
  await expect(subForm.getByRole("status")).toContainText("Added Mopane Thatchers");
  const rows = sipho.getByTestId("labour-row");
  await expect(rows).toHaveCount(2);
  const own = rows.filter({ hasText: "Mopane Thatchers" });
  await expect(own).toContainText("Thatching");
  await expect(own.getByText("Edit")).toBeVisible();
  // they can't edit another company's row
  await expect(rows.filter({ hasText: "Local builders" }).getByText("Edit")).toHaveCount(0);
  await own.getByText("Edit").click();
  await own.getByLabel("Headcount").fill("7");
  await own.getByRole("button", { name: "Save" }).click();
  await expect(own.getByRole("status")).toContainText("Saved");
  await expect(own.getByTestId("labour-figures")).toHaveText("7 people × 7.5 h");

  const uploader = sipho.getByTestId("log-photos");
  await uploader.getByLabel("Caption (optional)").fill("North slope done");
  await uploader.getByLabel("Choose photos").setInputFiles([{ name: "roof.png", mimeType: "image/png", buffer: await bigPng(sipho, 2400, 1800) }]);
  await expect(uploader.getByTestId("photo-upload-list")).toContainText("Saved, 1600×1200");
  await expect(uploader.getByTestId("photo")).toHaveCount(1);
  const href = await uploader.getByTestId("photo").locator("a").first().getAttribute("href");
  const full = await sipho.request.get(href!);
  expect(jpegSize(new Uint8Array(await full.body()))).toEqual({ width: 1600, height: 1200 });

  // the company's work description satisfies the mandatory work log; the item still blocks
  await page.reload();
  await expect(page.getByTestId("labour-total")).toHaveText("19 people · 148.5 man-hours");
  await page.getByTestId("publish-form").getByRole("button", { name: "Publish log" }).click();
  await expect(page.getByTestId("publish-form")).not.toContainText("The work log is mandatory");
  await expect(page.getByTestId("publish-form")).toContainText("Toolbox talk held");
  const toolbox = page.getByTestId("log-item").filter({ hasText: "Toolbox talk held" });
  await toolbox.getByRole("button", { name: "Yes" }).click();
  await expect(toolbox.getByRole("button", { name: "Yes" })).toHaveAttribute("aria-pressed", "true");
  await expect(toolbox).toContainText("Thandi Site Manager");
  const work = page.getByTestId("work-form");
  await work.getByLabel("Work carried out").fill("Masonry on villa 4 plinth; thatching villa 3.");
  await work.getByRole("button", { name: "Save" }).click();
  await expect(work.getByRole("status")).toContainText("Saved");

  // publish locks the log
  await page.getByTestId("publish-form").getByRole("button", { name: "Publish log" }).click();
  await expect(page.getByTestId("log-status")).toHaveText("Published");
  await expect(page.getByTestId("published-note")).toContainText("Published by Thandi Site Manager");
  await expect(page.getByTestId("add-labour-form")).toHaveCount(0);
  await expect(page.getByTestId("work-form")).toHaveCount(0);
  await expect(page.getByTestId("work-summary")).toHaveText("Masonry on villa 4 plinth; thatching villa 3.");
  await sipho.reload();
  await expect(sipho.getByTestId("add-labour-form")).toHaveCount(0);
  await expect(sipho.getByTestId("reopen-form")).toHaveCount(0);

  // the log is in the list and the gallery
  await page.goto(`${projectUrl}/daily-logs`);
  const row = page.getByTestId("log-row").first();
  await expect(row.getByTestId("log-status")).toHaveText("Published");
  await expect(row.getByTestId("log-labour")).toContainText("19 people");
  await expect(page.getByTestId("today-log")).toBeVisible();
  await page.goto(`${projectUrl}/docs/photos?filter=daily-logs`);
  await expect(page.getByTestId("photo")).toHaveCount(1);
  await expect(page.getByTestId("photo-daily-log")).toHaveText(`Daily log ${day}`);

  // PDF export
  const pdf = await page.request.get(`${new URL(logUrl).pathname.replace("/projects/", "/api/projects/")}/pdf`);
  expect(pdf.ok()).toBe(true);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  const doc = await PDFDocument.load(await pdf.body());
  expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  expect(doc.getTitle()).toBe(`Daily log ${day}`);
  const subPdf = await sipho.request.get(`${new URL(logUrl).pathname.replace("/projects/", "/api/projects/")}/pdf`);
  expect(subPdf.ok()).toBe(true);

  // the project admin (a Daily Logs Manager) reopens it
  await page.goto(logUrl);
  await page.getByTestId("reopen-form").getByRole("button", { name: "Reopen" }).click();
  await expect(page.getByTestId("log-status")).toHaveText("Draft");
  await expect(page.getByTestId("add-labour-form")).toBeVisible();

  // a future day can't be started; an earlier day can
  const tomorrow = new Date(`${day}T00:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  await page.goto(`${projectUrl}/daily-logs/${tomorrow.toISOString().slice(0, 10)}`);
  await expect(page.getByTestId("no-log")).toContainText("hasn't happened yet");
  await expect(page.getByTestId("start-log-form")).toHaveCount(0);
  await page.goto(logUrl);
  await page.getByRole("link", { name: "← Previous day" }).click();
  await page.getByTestId("start-log-form").getByRole("button", { name: "Start log for this day" }).click();
  await expect(page.getByTestId("log-status")).toHaveText("Draft");
  await expect(page.getByTestId("weather-source")).toContainText("Open-Meteo");
  await page.goto(`${projectUrl}/daily-logs`);
  await expect(page.getByTestId("log-row")).toHaveCount(2);
});

test("daily logs work at phone width", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 740 } });
  const page = await ctx.newPage();
  const stamp = Date.now();
  await signUpWithProject(page, stamp, "Phone Logs Camp");
  const projectUrl = page.url().replace(/\/admin.*$/, "");
  const noOverflow = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await page.goto(`${projectUrl}/daily-logs`);
  await expect(page.getByRole("heading", { name: "Daily Logs" })).toBeVisible();
  await noOverflow();
  await page.getByRole("button", { name: "Start today's log" }).click();
  await expect(page.getByTestId("log-status")).toHaveText("Draft");
  const labour = page.getByTestId("add-labour-form");
  await labour.getByLabel(/Crew name/).fill("Bush camp crew with a rather long name for small screens");
  await labour.getByLabel("Headcount").fill("8");
  await labour.getByRole("button", { name: "Add labour" }).click();
  await expect(labour.getByRole("status")).toContainText("Added");
  await page.getByText("Edit weather").click();
  await noOverflow();
  await page.goto(`${projectUrl}/daily-logs`);
  await expect(page.getByTestId("log-row")).toHaveCount(1);
  await noOverflow();
  await page.goto(`${projectUrl}/daily-logs/settings`);
  await expect(page.getByRole("heading", { name: "Daily Logs settings" })).toBeVisible();
  await noOverflow();
  await ctx.close();
});

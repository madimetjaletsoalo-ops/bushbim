import { createHmac } from "node:crypto";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";

const MESSAGING = "http://localhost:3102";

async function signUpWithProject(page: Page, stamp: number, prefix: string, project: string) {
  await page.goto("/signup");
  await page.getByLabel("Organisation").fill(`Okavango Camps ${stamp}`);
  await page.getByLabel("Your name").fill("Naledi Manager");
  await page.getByLabel("Work email").fill(`${prefix}${stamp}@okavango.test`);
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

/** Waits until the service worker controls the page, so later loads go through it. */
async function serviceWorkerReady(page: Page) {
  await page.waitForFunction(async () => !!(await navigator.serviceWorker.ready).active);
  // the first page load isn't controlled yet; reload once so it is
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
}

/** Waits until a page is in the service worker's cache. */
async function cached(page: Page, path: string) {
  await expect
    .poll(() => page.evaluate(async (p) => !!(await caches.match(p, { ignoreVary: true })), path), { timeout: 15_000 })
    .toBe(true);
}

// The offline tests reach the app through a switchable proxy (tests/e2e/mock-offline-proxy.mjs):
// Playwright's setOffline doesn't apply to a service worker's own requests, so "offline" also cuts
// the proxy, and pages can only come from the worker's cache. Tests in this file run one at a time.
const PROXY = "http://localhost:3103";
test.describe.configure({ mode: "serial" });
test.use({ baseURL: PROXY });
test.beforeEach(async ({ request }) => {
  await request.post(`${PROXY}/__proxy/online`);
});

async function network(ctx: BrowserContext, page: Page, offline: boolean) {
  await page.request.post(`${PROXY}/__proxy/${offline ? "offline" : "online"}`);
  await ctx.setOffline(offline);
  await page.waitForFunction((off) => navigator.onLine === !off, offline);
}
const goOffline = (ctx: BrowserContext, page: Page) => network(ctx, page, true);

function jpeg(page: Page) {
  return page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 2400;
    c.height = 1600;
    const g = c.getContext("2d")!;
    g.fillStyle = "#6b4f2e";
    g.fillRect(0, 0, 2400, 1600);
    const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), "image/png"));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
}

async function samplePdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([600, 400]).drawText("A-101 CAMP PLAN", { x: 40, y: 360, size: 20, font });
  return Buffer.from(await doc.save());
}

const sent = async (page: Page) => (await (await page.request.get(`${MESSAGING}/sent`)).json()) as { channel: string; to: string; template: { name: string; components: { parameters: { text: string }[] }[] } | null; subject?: string }[];

test("PWA: installable, recent sheet and issue work offline, an issue and photo made offline sync", async ({ page, context }) => {
  const stamp = Date.now();
  await signUpWithProject(page, stamp, "pwa", "Chief's Island Camp");
  const projectPath = new URL(page.url()).pathname.split("/").slice(0, 3).join("/");

  // installable: a manifest with icons, linked from every page
  const manifest = await (await page.request.get("/manifest.webmanifest")).json();
  expect(manifest).toMatchObject({ name: "BushBIM", display: "standalone", start_url: "/projects" });
  expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  for (const icon of manifest.icons) expect((await page.request.get(icon.src)).status()).toBe(200);
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
  await serviceWorkerReady(page);

  // a sheet and an issue opened while online
  await page.getByRole("link", { name: "Document Control" }).click();
  await page.getByLabel("Choose files to upload").setInputFiles([{ name: "A-101 Camp plan.pdf", mimeType: "application/pdf", buffer: await samplePdf() }]);
  await expect(page.getByTestId("upload-list").getByText("Saved as V1")).toBeVisible();
  await page.getByTestId("file-row").getByTestId("view-link").click();
  await expect(page.getByTestId("pdf-canvas")).toHaveAttribute("data-rendered-page", "1");
  const viewerUrl = page.url();
  await cached(page, new URL(viewerUrl).pathname); // opened with an in-app link: kept by the app

  await page.goto(`${projectPath}/issues/new`);
  const form = page.getByTestId("issue-form");
  await form.getByLabel("Title").fill("Deck boards warped at tent 4");
  await form.getByRole("button", { name: "Create issue" }).click();
  await expect(page.getByRole("heading", { name: /#1 Deck boards warped/ })).toBeVisible();
  const issueUrl = page.url();
  await cached(page, new URL(issueUrl).pathname);
  await cached(page, `${projectPath}/issues/new`); // warmed without being reopened

  // offline: the issue and the sheet still open
  await goOffline(context, page);
  await page.goto(issueUrl);
  await expect(page.getByRole("heading", { name: /#1 Deck boards warped/ })).toBeVisible();
  await expect(page.getByTestId("offline-bar")).toContainText("You're offline");
  await page.goto(viewerUrl);
  await expect(page.getByTestId("pdf-canvas")).toHaveAttribute("data-rendered-page", "1");
  // a page never opened on this device shows the offline page
  await page.goto(`${projectPath}/search?q=thatch-${stamp}`);
  await expect(page.getByTestId("offline-page")).toBeVisible();

  // an issue with a photo, created offline
  await page.goto(`${projectPath}/issues/new`);
  const offlineForm = page.getByTestId("issue-form");
  await offlineForm.getByLabel("Title").fill("Generator shed door off its hinge");
  await offlineForm.getByLabel("Description").fill("Found on the evening walk-round.");
  await offlineForm.getByRole("button", { name: "Create issue" }).click();
  await expect(offlineForm.getByRole("status")).toContainText("Saved on this device");
  await page.getByLabel("Choose photos for the offline issue").setInputFiles([{ name: "shed.png", mimeType: "image/png", buffer: Buffer.from(await jpeg(page)) }]);
  await expect(page.getByTestId("offline-photo-count")).toHaveText("1 photo saved on this device.");
  await expect(page.getByTestId("offline-pending")).toHaveText("2 changes waiting to sync");

  // back online: both sync on their own
  await network(context, page, false);
  await expect(page.getByTestId("offline-bar")).toHaveCount(0, { timeout: 20_000 });
  await page.goto(`${projectPath}/issues`);
  await page.getByTestId("issue-row").filter({ hasText: "Generator shed door" }).getByRole("link").click();
  await expect(page.getByRole("heading", { name: /#2 Generator shed door/ })).toBeVisible();
  await expect(page.getByText("Found on the evening walk-round.")).toBeVisible();
  await expect(page.getByTestId("issue-photos").getByRole("heading", { name: "Photos (1)" })).toBeVisible();
  await page.goto(`${projectPath}/offline`);
  await expect(page.getByTestId("offline-synced").getByRole("row")).toHaveCount(3); // header + issue + photo
});

test("offline checklist answers: merged, synced, and a conflict resolved with 'Use my answer'", async ({ page, context, browser }) => {
  const stamp = Date.now();
  await signUpWithProject(page, stamp, "chk", "Xakanaxa Camp");
  const projectPath = new URL(page.url()).pathname.split("/").slice(0, 3).join("/");
  await serviceWorkerReady(page);

  await page.goto(`${projectPath}/checklists/new`);
  const form = page.getByTestId("checklist-form");
  const pool = await form.getByLabel("Template").locator("option", { hasText: "Pool commissioning" }).innerText();
  await form.getByLabel("Template").selectOption({ label: pool.trim() });
  await form.getByLabel("Title").fill("Main pool");
  await form.getByRole("button", { name: "Create checklist" }).click();
  await expect(page.getByRole("heading", { name: "Main pool" })).toBeVisible();
  const checklistUrl = page.url();
  await cached(page, new URL(checklistUrl).pathname);

  // a second device, signed in as the same person, stays online
  // (straight to the app, not through the proxy, so it stays online)
  const other = await (await browser.newContext({ baseURL: "http://localhost:3100" })).newPage();
  await other.goto("/login");
  await other.getByLabel("Email").fill(`chk${stamp}@okavango.test`);
  await other.getByLabel("Password").fill("password123");
  await other.getByRole("button", { name: "Sign in" }).click();
  await expect(other.getByRole("heading", { name: "Projects" })).toBeVisible();
  await other.goto(new URL(checklistUrl).pathname);
  await expect(other.getByRole("heading", { name: "Main pool" })).toBeVisible();

  const yesNo = page.getByTestId("checklist-item").filter({ has: page.getByTestId("yes-no-form") });
  const first = yesNo.nth(0);
  const second = yesNo.nth(1);
  const firstLabel = (await first.locator("p").first().innerText()).replace(/\s*\*$/, "");

  await goOffline(context, page);
  await page.reload();
  await first.getByRole("button", { name: "No", exact: true }).click();
  await expect(first.getByRole("status")).toContainText("Saved on this device");
  await first.getByRole("button", { name: "Yes", exact: true }).click(); // changed my mind: replaces the waiting answer
  await second.getByRole("button", { name: "N/A" }).click();
  await expect(page.getByTestId("offline-pending")).toHaveText("2 changes waiting to sync");

  // meanwhile the other device answers the first item differently
  await other.getByTestId("checklist-item").filter({ has: other.getByTestId("yes-no-form") }).nth(0).getByRole("button", { name: "No", exact: true }).click();
  await expect(other.getByTestId("checklist-item").filter({ has: other.getByTestId("yes-no-form") }).nth(0).getByRole("button", { name: "No", exact: true })).toHaveAttribute("aria-pressed", "true");

  await network(context, page, false);
  await expect(page.getByTestId("offline-attention")).toHaveText("1 offline change needs your attention", { timeout: 20_000 });
  await page.getByTestId("offline-attention").click();
  const conflict = page.getByTestId("offline-conflict");
  await expect(conflict.getByTestId("offline-conflict-message")).toContainText(`Someone else answered "${firstLabel}"`);
  await expect(conflict.getByTestId("theirs")).toHaveText("NO");
  await expect(conflict.getByTestId("mine")).toHaveText("YES");
  await conflict.getByRole("button", { name: "Use my answer" }).click();
  await expect(page.getByTestId("offline-conflict")).toHaveCount(0);

  await page.goto(checklistUrl);
  await expect(first.getByRole("button", { name: "Yes", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(second.getByRole("button", { name: "N/A" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("offline-bar")).toHaveCount(0);
});

test("notifications: WhatsApp opt-in, test message, issue assignment by WhatsApp and email, STOP reply", async ({ page, browser }) => {
  const stamp = Date.now();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await signUpWithProject(page, stamp, "wa", "Vumbura Plains");
  const projectPath = new URL(page.url()).pathname.split("/").slice(0, 3).join("/");
  const thabo = await inviteAndJoin(page, browser, `thabo${stamp}@okavango.test`, "Thabo Foreman");
  const digits = String(stamp).slice(-7);
  const number = `+2782${digits}`;

  // WhatsApp is off until the user opts in with a number
  await thabo.getByTestId("account-link").click();
  await expect(thabo.getByRole("heading", { name: "Notifications" })).toBeVisible();
  const prefs = thabo.getByTestId("notification-prefs");
  await prefs.getByTestId("wa-opt-in").check();
  await prefs.getByRole("button", { name: "Save preferences" }).click();
  await expect(prefs.getByRole("alert")).toContainText("Add your WhatsApp number");
  await prefs.getByTestId("wa-opt-in").check();
  await prefs.getByLabel("WhatsApp number").fill(`082 ${digits.slice(0, 3)} ${digits.slice(3)}`);
  await prefs.getByRole("button", { name: "Save preferences" }).click();
  await expect(prefs.getByRole("status")).toContainText("WhatsApp notifications are on");
  await thabo.reload();
  await expect(thabo.getByTestId("wa-opted-in")).toContainText(`+27 82 *** ${digits.slice(-4)}`);
  await expect(thabo.getByLabel("WhatsApp number")).toHaveValue(number);

  // a test message
  await thabo.getByTestId("test-whatsapp").getByRole("button").click();
  await expect(thabo.getByTestId("test-whatsapp").getByRole("status")).toContainText("Test sent");
  await expect.poll(async () => (await sent(thabo)).filter((m) => m.channel === "whatsapp" && m.to === number.slice(1)).length).toBe(1);
  await thabo.reload();
  await expect(thabo.getByTestId("notification-row").first().getByTestId("delivery-whatsapp")).toHaveAttribute("data-status", "SENT");

  // an issue assigned to Thabo reaches WhatsApp (template) and email
  await page.goto(`${projectPath}/issues/new`);
  const form = page.getByTestId("issue-form");
  await form.getByLabel("Title").fill("Boardwalk handrail loose");
  await form.getByLabel("Assigned to").selectOption({ label: "Thabo Foreman" });
  await form.getByRole("button", { name: "Create issue" }).click();
  await expect(page.getByRole("heading", { name: /#1 Boardwalk handrail/ })).toBeVisible();
  await expect
    .poll(async () => (await sent(page)).filter((m) => m.channel === "whatsapp" && m.to === number.slice(1) && m.template?.components[0].parameters[0].text === "#1 assigned to you").length)
    .toBe(1);
  const wa = (await sent(page)).find((m) => m.channel === "whatsapp" && m.template?.components[0].parameters[0].text === "#1 assigned to you" && m.to === number.slice(1))!;
  expect(wa.template!.name).toBe("bushbim_notification");
  expect(wa.template!.components[0].parameters[1].text).toContain('Naledi Manager assigned "Boardwalk handrail loose" to you on Vumbura Plains.');
  expect(wa.template!.components[0].parameters[2].text).toMatch(/^http:\/\/localhost:\d+\/projects\/.+\/issues\/.+/);
  await expect.poll(async () => (await sent(page)).some((m) => m.channel === "email" && m.to === `thabo${stamp}@okavango.test` && m.subject === "BushBIM: #1 assigned to you")).toBe(true);
  // the person who assigned it isn't notified
  expect((await sent(page)).some((m) => m.channel === "email" && m.to === `wa${stamp}@okavango.test` && m.subject?.includes("#1"))).toBe(false);

  await thabo.reload();
  const row = thabo.getByTestId("notification-row").filter({ hasText: "#1 assigned to you" });
  await expect(row.getByTestId("delivery-whatsapp")).toHaveAttribute("data-status", "SENT");
  await expect(row.getByTestId("delivery-email")).toHaveAttribute("data-status", "SENT");

  // webhook: Meta's verification handshake, an unsigned post is refused, a signed STOP opts out
  const verify = await page.request.get("/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=abc123");
  expect(await verify.text()).toBe("abc123");
  expect((await page.request.get("/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=x")).status()).toBe(403);
  const body = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ from: number.slice(1), type: "text", text: { body: "STOP" } }] } }] }] });
  expect((await page.request.post("/api/whatsapp/webhook", { data: body, headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=00" } })).status()).toBe(403);
  const sig = createHmac("sha256", "test-whatsapp-app-secret").update(body).digest("hex");
  expect((await page.request.post("/api/whatsapp/webhook", { data: body, headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${sig}` } })).status()).toBe(200);
  await thabo.reload();
  await expect(thabo.getByTestId("wa-opt-in")).not.toBeChecked();
});

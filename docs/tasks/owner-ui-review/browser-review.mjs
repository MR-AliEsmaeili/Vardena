// Optional manual browser-review tooling, deliberately not a product dependency.
// Install playwright-core + @sparticuz/chromium@131.0.1 OUTSIDE the checkout.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const tools = process.env.OWNER_REVIEW_TOOLS_DIR;
if (!tools)
  throw new Error(
    "Set OWNER_REVIEW_TOOLS_DIR to the external tooling package directory.",
  );
const require = createRequire(`${tools}/package.json`);
const { chromium: playwright } = require("playwright-core");
const chromium = require("@sparticuz/chromium");
import fs from "node:fs/promises";
const output = fileURLToPath(new URL("./", import.meta.url));
const browser = await playwright.launch({
  executablePath: await chromium.executablePath(),
  args: chromium.args.filter((a) => a !== "--single-process"),
  headless: true,
});
const results = [];
const permissions = [
  "customers.view",
  "customers.write",
  "users.manage",
  "audit.view",
  "operations.view",
  "operations.record",
  "replacements.authorize",
  "licenses.view",
  "licenses.issue.time_limited",
  "licenses.issue.perpetual",
  "licenses.download",
];
const admin = {
  id: "01K76ZC2C29NQRB7R7R3GZAGZN",
  username: "owner-test",
  role: "OWNER_ADMIN",
  isActive: true,
  mustChangePassword: false,
  createdAt: "2026-10-15T00:00:00.000Z",
};
const widths = [1440, 768, 360];
async function visit(port, path, width, mode = "empty") {
  const context = await browser.newContext({
    viewport: { width, height: 1000 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let release;
  const held = new Promise((r) => (release = r));
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/api/v1", "");
    const reply = (data, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(data),
      });
    if (path === "/auth/me")
      return mode === "login"
        ? reply({ code: "Unauthorized", message: "test session absent" }, 401)
        : reply(admin);
    if (path === "/permissions/effective") return reply({ permissions });
    if (path === "/customers" && route.request().method() === "POST") {
      await held;
      return reply(
        { code: "ServiceUnavailable", message: "test failure" },
        503,
      );
    }
    if (mode === "loading" && path === "/customers") await held;
    if (mode === "error" && path === "/customers")
      return reply(
        { code: "ServiceUnavailable", message: "test failure" },
        503,
      );
    if (
      [
        "/customers",
        "/users",
        "/signing-keys",
        "/license-issuances",
        "/operational-records",
        "/audit-events",
      ].includes(path)
    )
      return reply({
        items: [],
        total: 0,
        page: 1,
        pageSize: 50,
        hasNext: false,
      });
    errors.push("Unexpected API: " + path);
    return reply({ code: "EntityNotFound", message: "test not found" }, 404);
  });
  await page.goto(`http://localhost:${port}${path}`);
  if (mode === "login")
    await page.getByLabel("نام کاربری", { exact: true }).waitFor();
  else await page.locator("#main-content").waitFor();
  if (mode === "loading")
    await page
      .locator(
        '[data-testid="background-activity-indicator"][data-visible="true"]',
      )
      .waitFor();
  else if (mode === "error") await page.getByRole("alert").first().waitFor();
  else if (mode === "submit") {
    await page.locator("#customerCode").fill("UI.TEST");
    await page.locator("#displayName").fill("مشتری آزمایشی بررسی رابط");
    await page.locator('form button[type="submit"]').click();
    await page
      .locator('[data-testid="global-request-indicator"][data-visible="true"]')
      .waitFor();
    const button = page.locator('form button[type="submit"]');
    if (
      !(await button.isDisabled()) ||
      (await button.getAttribute("aria-busy")) !== "true"
    )
      throw new Error("Missing pending button contract");
  } else
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="loading-state"]'),
    );
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => scrollTo(0, 0));
  const dimensions = await page.evaluate(() => ({
    viewport: innerWidth,
    scroll: document.documentElement.scrollWidth,
    direction: getComputedStyle(document.documentElement).direction,
  }));
  const name = `${port === 4174 ? "before" : "after"}-${path.split("/").filter(Boolean).join("-")}-${width}-${mode}-fixture`;
  // Limit committed screenshots; every route/width still gets a real measurement.
  if (
    (width === 1440 || width === 360) &&
    (["login", "submit", "loading", "error"].includes(mode) ||
      ["/app/licenses", "/app/customers"].includes(path))
  )
    await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
  results.push({ name, ...dimensions, errors });
  release();
  await context.close();
}
try {
  for (const port of [4174, 5174])
    for (const width of [1440, 360]) await visit(port, "/app/licenses", width);
  for (const width of widths) {
    for (const path of [
      "/app",
      "/app/customers",
      "/app/customers/new",
      "/app/users",
      "/app/signing-keys",
      "/app/audit",
      "/app/operations",
      "/app/operations/activation/new",
      "/app/operations/replacement/new",
      "/app/lifecycle",
      "/change-password",
    ])
      await visit(5174, path, width);
  }
  for (const width of [1440, 360]) {
    await visit(5174, "/login", width, "login");
    await visit(5174, "/app/customers", width, "loading");
    await visit(5174, "/app/customers", width, "error");
    await visit(5174, "/app/customers/new", width, "submit");
  }
} finally {
  await fs.writeFile(
    `${output}/browser-results.json`,
    JSON.stringify(
      {
        browser: "Chromium 131 (npm @sparticuz/chromium)",
        api: "Intercepted test fixtures only. No live Owner API, DB or signer used.",
        results,
      },
      null,
      2,
    ),
  );
  await browser.close();
}
const failed = results.filter(
  (r) => r.scroll > r.viewport || r.direction !== "rtl" || r.errors.length,
);
console.log(JSON.stringify({ cases: results.length, failed }, null, 2));
if (failed.length) process.exitCode = 1;

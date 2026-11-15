import { expect, test } from "@playwright/test";
import { expectNoOverflow, makePolicy, makeWorkspace, mockWorkspace, navigate } from "./fixtures";

const viewports = [
  { width: 320, height: 740 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
  { width: 667, height: 375 },
];
const sections = ["Overview", "Policy records", "Customers", "Import center", "Renewal action center", "Analytics", "Settings"];

for (const viewport of viewports) {
  test(`workspace and overlays fit ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const workspace = makeWorkspace();
    workspace.policies.push(makePolicy({
      id: "long-record", policyNumber: `LONG-${"1234567890".repeat(5)}`,
      customerName: "A Very Long Fictional Customer Name For Responsive Layout Checks",
      insurer: "ExampleInternationalInsuranceCompanyWithoutSpaces".repeat(2),
      email: `${"sample".repeat(12)}@example.test`,
      sourceFile: `${"long-filename-".repeat(10)}.csv`,
      premium: 999999999999.99,
    }));
    workspace.profile.agency = "An Example Agency With A Very Long Workspace Name";
    const state = await mockWorkspace(page, workspace);
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Sample");

    for (const theme of ["light", "dark"] as const) {
      await navigate(page, "Settings");
      await page.getByRole("radio", { name: theme === "light" ? /Light Warm/ : /Dark Near/ }).click();
      for (const section of sections) {
        await navigate(page, section);
        await expectNoOverflow(page);
        const buttons = page.locator(".welcome-actions button");
        for (const button of await buttons.all()) {
          await button.scrollIntoViewIfNeeded();
          await expect(button).toBeInViewport();
          const box = await button.boundingBox();
          expect(box && box.x >= 0 && box.x + box.width <= viewport.width + 1).toBeTruthy();
        }
      }
      await navigate(page, "Overview");
      await page.screenshot({ path: testInfo.outputPath(`overview-${theme}.png`), fullPage: true });
    }

    await page.getByRole("button", { name: "Add policy", exact: true }).click();
    const form = page.getByRole("dialog", { name: "Add a new policy" });
    await expect(form).toBeVisible();
    await expectNoOverflow(page);
    await form.getByRole("button", { name: "Add policy", exact: true }).scrollIntoViewIfNeeded();
    await expect(form.getByRole("button", { name: "Add policy", exact: true })).toBeInViewport();
    await page.keyboard.press("Escape");
    await expect(form).not.toBeVisible();
    await expect(page.getByRole("button", { name: "Add policy", exact: true })).toBeFocused();

    await page.getByRole("button", { name: "Sample Customer One Policy TEST-001" }).click();
    const drawer = page.getByRole("dialog", { name: "Policy details", exact: true });
    await expect(drawer).toBeVisible();
    await expectNoOverflow(page);
    await drawer.getByRole("button", { name: "Edit", exact: true }).click();
    const edit = page.getByRole("dialog", { name: "Edit policy", exact: true });
    await expect(edit).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(edit).not.toBeVisible();
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Edit", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(drawer).not.toBeVisible();

    await page.getByRole("button", { name: "Add files", exact: true }).last().click();
    const importer = page.getByRole("dialog", { name: "Add your policy files" });
    await expect(importer).toBeVisible();
    await importer.locator('input[type="file"]').setInputFiles({
      name: "fictional-import.csv", mimeType: "text/csv",
      buffer: Buffer.from("Customer Name,Policy Number,Insurance Company,Expiry Date,Premium\nImported Sample,IMPORTED-001,Sample Insurer,20/11/2026,12000\n"),
    });
    await expect(importer.getByRole("button", { name: "Import & analyse" })).toBeEnabled();
    await expectNoOverflow(page);
    await importer.getByRole("button", { name: "Import & analyse" }).click();
    await expect(importer).not.toBeVisible();
    await expect(page.locator(".success-banner")).toContainText("1 new policy");
    await expect.poll(() => state.policies.some((row) => row.policy_number === "IMPORTED-001")).toBe(true);
    expect(state.unexpectedRequests).toEqual([]);
    expect(errors).toEqual([]);
  });
}

for (const viewport of [viewports[0], viewports[2], viewports[6]]) {
  test(`public pages and mobile menu fit ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockWorkspace(page);
    await page.goto("/");
    await expectNoOverflow(page);
    await page.getByRole("button", { name: "Open menu", exact: true }).click();
    await expect(page.getByRole("button", { name: "Close menu", exact: true })).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Platform" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Open menu", exact: true })).toBeFocused();
    for (const path of ["/login", "/signup", "/auth/recover", "/auth/reset-password"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoOverflow(page);
      await expect(page.locator("form input").first()).toHaveCSS("font-size", "16px");
    }
  });
}

test("mobile navigation traps focus, restores it, and dismisses on resize", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await mockWorkspace(page);
  await page.goto("/dashboard");
  const toggle = page.getByRole("button", { name: "Open navigation", exact: true });
  await toggle.click();
  const menu = page.getByRole("dialog", { name: "Workspace navigation" });
  await expect(menu).toBeVisible();
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press("Tab");
    expect(await menu.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(toggle).toBeFocused();
  await toggle.click();
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(menu).not.toBeVisible();
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
});

test("onboarding and an empty workspace fit a narrow phone", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 600 });
  const workspace = makeWorkspace();
  workspace.profile.onboarded = false;
  workspace.policies = [];
  workspace.imports = [];
  await mockWorkspace(page, workspace);
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("set up your workspace");
  await expectNoOverflow(page);
  await page.getByRole("button", { name: "Skip for now", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Start with your own spreadsheets" })).toBeVisible();
  await expectNoOverflow(page);
});

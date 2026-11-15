import { expect, test } from "@playwright/test";
import { makeBackup, makePolicy, makeWorkspace, mockWorkspace, navigate, TEST_NOW } from "./fixtures";

test("keeps notes on the correct policy when changing records before debounce", async ({ page }) => {
  const workspace = makeWorkspace();
  workspace.policies[1] = makePolicy({ id: "test-policy-2", policyNumber: "TEST-002", expiryDate: "2026-11-20" });
  const state = await mockWorkspace(page, workspace);
  await page.clock.install({ time: TEST_NOW });
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: /Good afternoon/ })).toBeVisible();
  await page.clock.pauseAt(new Date(TEST_NOW.getTime() + 10 * 60_000));
  await page.getByRole("button", { name: "Sample Customer One Policy TEST-001" }).click();
  await page.getByLabel("Notes", { exact: true }).fill("First policy note");
  await page.getByRole("button", { name: /Motor · Sample Insurer/ }).click();
  await page.getByLabel("Notes", { exact: true }).fill("Second policy note");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.clock.runFor(500);
  await expect.poll(() => state.policies.find((row) => row.id === "test-policy-1")?.note).toBe("First policy note");
  await expect.poll(() => state.policies.find((row) => row.id === "test-policy-2")?.note).toBe("Second policy note");
  expect(state.unexpectedRequests).toEqual([]);
});

test("flushes note changes before signing out", async ({ page }) => {
  const state = await mockWorkspace(page);
  await page.clock.install({ time: TEST_NOW });
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: /Good afternoon/ })).toBeVisible();
  await page.clock.pauseAt(new Date(TEST_NOW.getTime() + 10 * 60_000));
  await page.getByRole("button", { name: "Sample Customer One Policy TEST-001" }).click();
  await page.getByLabel("Notes", { exact: true }).fill("Save before logout");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.locator(".top-sign-out").click();
  await expect(page).toHaveURL(/\/login$/);
  expect(state.policies.find((row) => row.id === "test-policy-1")?.note).toBe("Save before logout");
  const logout = state.log.indexOf("POST /auth/v1/logout");
  expect(logout).toBeGreaterThan(state.log.lastIndexOf("POST /rest/v1/policy_records"));
});

test("retains the workspace when saving before sign-out fails", async ({ page }) => {
  const state = await mockWorkspace(page);
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Sample");
  state.failSaves = true;
  await page.locator(".top-sign-out").click();
  await expect(page.getByRole("alert").filter({ hasText: "Sign-out stopped" })).toBeVisible();
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(state.log).not.toContain("POST /auth/v1/logout");
  state.failSaves = false;
  await page.locator(".top-sign-out").click();
  await expect(page).toHaveURL(/\/login$/);
});

test("shows a failed sign-out without replacing the open dashboard", async ({ page }) => {
  const state = await mockWorkspace(page);
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Sample");
  state.failLogout = true;
  await page.locator(".top-sign-out").click();
  await expect(page.getByRole("alert").filter({ hasText: "Sign-out stopped" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Sample");
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("rejects malformed backup data without confirming or changing records", async ({ page }) => {
  const state = await mockWorkspace(page);
  await page.goto("/dashboard");
  await navigate(page, "Settings");
  const backup = makeBackup();
  Object.assign(backup.policies[0], { phone: 123 });
  let confirmations = 0;
  page.on("dialog", (dialog) => { confirmations++; void dialog.dismiss(); });
  await page.locator('input[type="file"][accept=".json,application/json"]').setInputFiles({ name: "invalid.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(backup)) });
  await expect(page.locator(".toast.error")).toContainText("phone must be text");
  expect(confirmations).toBe(0);
  expect(state.policies).toHaveLength(3);
  expect(state.policies[0].phone).toBe("9876543210");
  expect(state.unexpectedRequests).toEqual([]);
});

test("restores a valid backup with confirmation and syncs the replacement", async ({ page }) => {
  const state = await mockWorkspace(page);
  await page.goto("/dashboard");
  await navigate(page, "Settings");
  const backup = makeBackup();
  backup.policies = [makePolicy({ id: "restored-policy", policyNumber: "RESTORED-001", customerName: "Restored Sample" })];
  page.once("dialog", (dialog) => { void dialog.accept(); });
  await page.locator('input[type="file"][accept=".json,application/json"]').setInputFiles({ name: "valid.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(backup)) });
  await expect(page.locator(".toast.ok")).toContainText("Restored 1 policies");
  await expect.poll(() => state.policies.map((row) => row.id)).toEqual(["restored-policy"]);
});

test("refreshes renewal counts and rows after midnight", async ({ page }) => {
  const workspace = makeWorkspace();
  workspace.policies = [makePolicy({ expiryDate: "2026-11-15" })];
  await mockWorkspace(page, workspace);
  const beforeMidnight = new Date("2026-11-15T23:59:58+05:30");
  await page.clock.install({ time: new Date("2026-11-15T23:00:00+05:30") });
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Sample");
  await page.clock.pauseAt(beforeMidnight);
  await navigate(page, "Renewal action center");
  await expect(page.locator(".queue-chips").getByRole("button", { name: "Overdue 0", exact: true })).toBeVisible();
  await expect(page.locator(".queue-row")).toHaveCount(1);
  await page.clock.runFor(2500);
  await expect(page.locator(".queue-chips").getByRole("button", { name: "Overdue 1", exact: true })).toBeVisible();
  await expect(page.locator(".queue-row")).toHaveCount(0);
  await page.locator(".queue-chips").getByRole("button", { name: "Overdue 1", exact: true }).click();
  await expect(page.locator(".queue-row")).toHaveCount(1);
});

test("adds and edits a policy through the real form", async ({ page }) => {
  const state = await mockWorkspace(page);
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Add policy", exact: true }).click();
  const form = page.getByRole("dialog", { name: "Add a new policy" });
  await form.getByLabel(/Customer name/).fill("Manual Sample");
  await form.getByLabel(/Policy number/).fill("MANUAL-001");
  await form.getByLabel("Insurance company", { exact: true }).fill("Sample Insurer");
  await form.getByLabel("Policy type", { exact: true }).fill("Motor");
  await form.getByLabel(/Expiry \/ renewal date/).fill("2026-12-20");
  await form.getByLabel("Premium (₹)", { exact: true }).fill("12345");
  await form.getByRole("button", { name: "Add policy", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Policy details", exact: true });
  await expect(drawer).toBeVisible();
  await expect.poll(() => state.policies.some((row) => row.policy_number === "MANUAL-001")).toBe(true);
  await drawer.getByRole("button", { name: "Edit", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Edit policy", exact: true });
  await edit.getByLabel("Premium (₹)", { exact: true }).fill("23456");
  await edit.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(edit).not.toBeVisible();
  await expect(drawer).toBeVisible();
  await expect.poll(() => state.policies.find((row) => row.policy_number === "MANUAL-001")?.premium).toBe(23456);
});

test("an invalid analytics date range displays an empty chart without SVG errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mockWorkspace(page);
  await page.goto("/dashboard");
  await navigate(page, "Analytics");
  await page.getByLabel("Expiry from", { exact: true }).fill("2026-12-01");
  await page.getByLabel("Expiry to", { exact: true }).fill("2026-10-01");
  await expect(page.getByRole("alert")).toContainText("start date must be on or before");
  await expect(page.getByText("No months to show for this date range.")).toBeVisible();
  expect(errors).toEqual([]);
});

test("reports a load failure without overwriting cloud data", async ({ page }) => {
  const state = await mockWorkspace(page);
  state.failLoads = true;
  await page.goto("/dashboard");
  await expect(page.getByRole("alert")).toContainText("Fictional load failure");
  expect(state.log.filter((line) => line.startsWith("POST /rest/v1/"))).toEqual([]);
});

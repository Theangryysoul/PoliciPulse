import { expect, type Page } from "@playwright/test";
import type { Policy, Workspace } from "../lib/types";
import { DEFAULT_SETTINGS, EMPTY_PROFILE } from "../lib/settings";

export const TEST_USER_ID = "00000000-0000-4000-8000-000000000001";
export const TEST_EMAIL = "agent@example.test";
export const TEST_NOW = new Date("2026-11-15T12:00:00+05:30");
const API_ORIGIN = "https://workspace-test.supabase.co";

export function makePolicy(overrides: Partial<Policy> = {}): Policy {
  return {
    id: "test-policy-1",
    customerName: "Sample Customer One",
    phone: "9876543210",
    email: "customer.one@example.test",
    policyNumber: "TEST-001",
    insurer: "Sample Insurer",
    policyType: "Motor",
    startDate: "2025-11-16",
    expiryDate: "2026-11-16",
    premium: 18450,
    sourceFile: "fictional-policies.csv",
    sourceSheet: "Policies",
    sourceRow: 2,
    importedAt: "2026-11-14T12:00:00.000Z",
    importId: "test-import-1",
    followUp: "pending",
    note: "",
    ...overrides,
  };
}

export function makeWorkspace(): Required<Workspace> {
  return {
    policies: [
      makePolicy(),
      makePolicy({ id: "test-policy-2", policyNumber: "TEST-002", customerName: "Sample Customer Two", phone: "9876543211", email: "customer.two@example.test", expiryDate: "2026-11-20", policyType: "Health" }),
      makePolicy({ id: "test-policy-3", policyNumber: "TEST-003", customerName: "Sample Customer Three", phone: "9876543212", expiryDate: "2026-11-14", followUp: "interested", note: "Fictional follow-up note" }),
    ],
    imports: [{ id: "test-import-1", fileName: "fictional-policies.csv", sheetName: "Policies", added: 3, updated: 0, unchanged: 0, rejected: 0, importedAt: "2026-11-14T12:00:00.000Z" }],
    profile: { ...EMPTY_PROFILE, name: "Sample Agent", agency: "Example Agency", onboarded: true },
    settings: { ...DEFAULT_SETTINGS },
  };
}

export function makeBackup(workspace = makeWorkspace()) {
  return { app: "PolicyPulse", version: 2, exportedAt: TEST_NOW.toISOString(), ...workspace };
}

function policyRow(policy: Policy) {
  return {
    user_id: TEST_USER_ID, id: policy.id, customer_name: policy.customerName, phone: policy.phone, email: policy.email,
    policy_number: policy.policyNumber, insurer: policy.insurer, policy_type: policy.policyType, start_date: policy.startDate || null,
    expiry_date: policy.expiryDate, premium: policy.premium, source_file: policy.sourceFile, source_sheet: policy.sourceSheet,
    source_row: policy.sourceRow, imported_at: policy.importedAt, import_id: policy.importId, follow_up: policy.followUp, note: policy.note,
  };
}

/** Every network request is contained: no credentials, emails, or real workspace mutations. */
export async function mockWorkspace(page: Page, workspace = makeWorkspace()) {
  const user = { id: TEST_USER_ID, email: TEST_EMAIL, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00.000Z" };
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: TEST_USER_ID, role: "authenticated", exp: 4102444800 })}.fictional-signature`;
  await page.addInitScript(({ user, token }) => {
    localStorage.setItem("sb-workspace-test-auth-token", JSON.stringify({ access_token: token, refresh_token: "fictional-refresh-token", token_type: "bearer", expires_at: 4102444800, expires_in: 3600, user }));
  }, { user, token });

  type Row = Record<string, unknown>;
  const state = {
    policies: workspace.policies.map(policyRow) as Row[],
    imports: workspace.imports.map((record) => ({ user_id: TEST_USER_ID, id: record.id, file_name: record.fileName, sheet_name: record.sheetName, added: record.added, updated: record.updated, unchanged: record.unchanged, rejected: record.rejected, imported_at: record.importedAt })) as Row[],
    profile: { ...workspace.profile },
    settings: { ...workspace.settings },
    failSaves: false,
    failLogout: false,
    failLoads: false,
    log: [] as string[],
    unexpectedRequests: [] as string[],
  };

  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === "http://127.0.0.1:3100") return route.continue();
    if (url.hostname === "fonts.googleapis.com") return route.fulfill({ status: 200, contentType: "text/css", body: "" });
    if (url.origin !== API_ORIGIN) {
      state.unexpectedRequests.push(`${request.method()} ${url.origin}${url.pathname}`);
      return route.abort();
    }
    const headers = {
      "access-control-allow-origin": "http://127.0.0.1:3100",
      "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
      "access-control-allow-headers": "authorization, apikey, content-type, prefer, x-client-info, x-supabase-api-version, range, range-unit, accept, accept-profile, content-profile",
    };
    const json = (value: unknown, status = 200) => route.fulfill({ status, headers, contentType: "application/json", body: JSON.stringify(value) });
    const empty = (status: number) => route.fulfill({ status, headers, body: "" });
    const method = request.method();
    state.log.push(`${method} ${url.pathname}`);
    if (method === "OPTIONS") return empty(204);
    if (url.pathname === "/auth/v1/user") return json(user);
    if (url.pathname === "/auth/v1/token") return json({ user, access_token: token, refresh_token: "fictional-refresh-token", expires_in: 3600, token_type: "bearer" });
    if (url.pathname === "/auth/v1/logout") {
      return state.failLogout ? json({ message: "Fictional sign-out failure", code: "unexpected_failure" }, 500) : empty(204);
    }
    if (!url.pathname.startsWith("/rest/v1/")) {
      state.unexpectedRequests.push(`${method} ${url.pathname}`);
      return json({ message: "Unexpected test request" }, 400);
    }
    if (method === "GET" && state.failLoads) return json({ message: "Fictional load failure" }, 500);
    if (method !== "GET" && state.failSaves) return json({ message: "Fictional save failure" }, 500);
    const table = url.pathname.split("/").pop();
    if (table === "agent_workspaces") {
      if (method === "GET") return json({ profile: state.profile, settings: state.settings });
      const payload = request.postDataJSON();
      const row = Array.isArray(payload) ? payload[0] : payload;
      state.profile = row.profile;
      state.settings = row.settings;
      return empty(201);
    }
    if (table !== "policy_records" && table !== "policy_imports") return json({ message: "Unknown test table" }, 404);
    const rows = table === "policy_records" ? state.policies : state.imports;
    if (method === "GET") return json(rows);
    if (method === "DELETE") {
      const ids = (url.searchParams.get("id") ?? "").replace(/^in\.\(/, "").replace(/\)$/, "").split(",").map((id) => id.replace(/^"|"$/g, ""));
      const remaining = rows.filter((row) => !ids.includes(String(row.id)));
      if (table === "policy_records") state.policies = remaining;
      else state.imports = remaining;
      return empty(204);
    }
    const payload = request.postDataJSON();
    for (const row of (Array.isArray(payload) ? payload : [payload]) as Row[]) {
      const index = rows.findIndex((current) => current.id === row.id);
      if (index < 0) rows.push(row);
      else rows[index] = { ...rows[index], ...row };
    }
    return empty(201);
  });
  return state;
}

export async function navigate(page: Page, name: string) {
  await expect(page.locator(".shell")).toBeVisible();
  const toggle = page.getByRole("button", { name: "Open navigation", exact: true });
  if (await toggle.isVisible()) await toggle.click();
  const navigation = page.getByRole("dialog", { name: "Workspace navigation" });
  const scope = await navigation.isVisible() ? navigation : page.locator(".desktop-sidebar");
  await scope.getByRole("navigation", { name: "Workspace sections" }).getByRole("button", { name, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(name === "Overview" ? "Sample" : name);
}

export async function expectNoOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  const dialogs = page.locator("dialog[open]");
  for (const dialog of await dialogs.all()) {
    await expect.poll(() => dialog.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    const panel = dialog.locator(":scope > div");
    await expect.poll(() => panel.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  }
}

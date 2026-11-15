import type { FollowUp, ImportRecord, Policy, Workspace } from "./types";
import { mergeProfile, mergeSettings } from "./settings";
import { toISODate } from "./normalize";
import { FOLLOW_UP_ORDER } from "./analysis";

type RecordValue = Record<string, unknown>;
const MAX_PREMIUM = 999999999999.99;
const MAX_INTEGER = 2147483647;

function record(value: unknown, label: string): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as RecordValue;
}

function stringField(value: RecordValue, key: string, label: string, fallback?: string): string {
  const field = value[key];
  if (field === undefined && fallback !== undefined) return fallback;
  if (typeof field !== "string") throw new Error(`${label}: ${key} must be text.`);
  return field;
}

function requiredText(value: RecordValue, key: string, label: string): string {
  const field = stringField(value, key, label);
  if (!field.trim()) throw new Error(`${label}: ${key} cannot be empty.`);
  return field;
}

function numberField(value: RecordValue, key: string, label: string, maximum = MAX_INTEGER, fallback?: number): number {
  const field = value[key] === undefined ? fallback : value[key];
  if (typeof field !== "number" || !Number.isFinite(field) || field < 0 || field > maximum) {
    throw new Error(`${label}: ${key} must be a number between 0 and ${maximum}.`);
  }
  if (key !== "premium" && !Number.isInteger(field)) throw new Error(`${label}: ${key} must be a whole number.`);
  return field;
}

function dateField(value: RecordValue, key: string, label: string, optional = false): string {
  const field = stringField(value, key, label, optional ? "" : undefined);
  if (optional && field === "") return field;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(field) || toISODate(field) !== field) {
    throw new Error(`${label}: ${key} must be a valid YYYY-MM-DD date.`);
  }
  return field;
}

function timestampField(value: RecordValue, label: string): string {
  const field = requiredText(value, "importedAt", label);
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(field) ||
      toISODate(field.slice(0, 10)) !== field.slice(0, 10) || !Number.isFinite(Date.parse(field))) {
    throw new Error(`${label}: importedAt must be a valid ISO date or timestamp.`);
  }
  return field;
}

function readPolicy(value: unknown, index: number, legacy: boolean): Policy {
  const label = `Policy ${index + 1}`;
  const row = record(value, label);
  const followUp = stringField(row, "followUp", label, legacy ? "pending" : undefined);
  if (!FOLLOW_UP_ORDER.includes(followUp as FollowUp)) throw new Error(`${label}: unknown follow-up status.`);
  const startDate = dateField(row, "startDate", label, true);
  const expiryDate = dateField(row, "expiryDate", label);
  if (startDate && startDate > expiryDate) throw new Error(`${label}: startDate cannot be after expiryDate.`);
  return {
    id: requiredText(row, "id", label),
    customerName: requiredText(row, "customerName", label),
    policyNumber: requiredText(row, "policyNumber", label),
    insurer: requiredText(row, "insurer", label),
    policyType: requiredText(row, "policyType", label),
    phone: stringField(row, "phone", label, legacy ? "" : undefined),
    email: stringField(row, "email", label, legacy ? "" : undefined),
    startDate,
    expiryDate,
    premium: numberField(row, "premium", label, MAX_PREMIUM),
    sourceFile: stringField(row, "sourceFile", label),
    sourceSheet: stringField(row, "sourceSheet", label),
    sourceRow: numberField(row, "sourceRow", label),
    importedAt: timestampField(row, label),
    importId: requiredText(row, "importId", label),
    followUp: followUp as FollowUp,
    note: stringField(row, "note", label, legacy ? "" : undefined),
  };
}

function readImport(value: unknown, index: number, legacy: boolean): ImportRecord {
  const label = `Import ${index + 1}`;
  const row = record(value, label);
  return {
    id: requiredText(row, "id", label),
    fileName: requiredText(row, "fileName", label),
    sheetName: requiredText(row, "sheetName", label),
    added: numberField(row, "added", label),
    updated: numberField(row, "updated", label, MAX_INTEGER, legacy ? 0 : undefined),
    unchanged: numberField(row, "unchanged", label, MAX_INTEGER, legacy ? 0 : undefined),
    rejected: numberField(row, "rejected", label, MAX_INTEGER, legacy ? 0 : undefined),
    importedAt: timestampField(row, label),
  };
}

function assertUniqueIds(rows: { id: string }[], label: string) {
  const ids = new Set<string>();
  for (const row of rows) {
    if (ids.has(row.id)) throw new Error(`${label} contains duplicate record IDs.`);
    ids.add(row.id);
  }
}

/** Validate the entire backup before changing any state or asking to replace cloud records. */
export function parseBackup(value: unknown): Required<Workspace> {
  const data = record(value, "Backup");
  if (data.app !== "PolicyPulse") throw new Error("That does not look like a PolicyPulse backup file.");
  if (data.version !== undefined && data.version !== 1 && data.version !== 2) {
    throw new Error("This backup version is not supported. Export a version 1 or 2 backup.");
  }
  const legacy = data.version !== 2;
  if (!Array.isArray(data.policies)) throw new Error("Backup policies must be a list.");
  const policies = data.policies.map((row, index) => readPolicy(row, index, legacy));
  const rawImports = data.imports === undefined && legacy ? [] : data.imports;
  if (!Array.isArray(rawImports)) throw new Error("Backup imports must be a list.");
  const imports = rawImports.map((row, index) => readImport(row, index, legacy));
  assertUniqueIds(policies, "Policies");
  assertUniqueIds(imports, "Imports");
  if (data.profile != null) record(data.profile, "Profile");
  if (data.settings != null) record(data.settings, "Settings");
  return {
    policies,
    imports,
    profile: { ...mergeProfile(data.profile as Parameters<typeof mergeProfile>[0]), onboarded: true },
    settings: mergeSettings(data.settings as Parameters<typeof mergeSettings>[0]),
  };
}

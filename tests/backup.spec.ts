import { expect, test } from "@playwright/test";
import { parseBackup } from "../lib/backup";
import { makeBackup } from "./fixtures";

test("accepts an exported backup without mutating its records", () => {
  const backup = makeBackup();
  const before = JSON.stringify(backup);
  const result = parseBackup(backup);
  expect(result.policies).toEqual(backup.policies);
  expect(result.imports).toEqual(backup.imports);
  expect(result.policies[0]).not.toBe(backup.policies[0]);
  expect(JSON.stringify(backup)).toBe(before);
});

test("accepts documented legacy optional fields", () => {
  const backup = makeBackup();
  const legacy = JSON.parse(JSON.stringify(backup));
  legacy.version = 1;
  delete legacy.profile;
  delete legacy.settings;
  delete legacy.policies[0].phone;
  delete legacy.policies[0].email;
  delete legacy.policies[0].followUp;
  delete legacy.policies[0].note;
  const result = parseBackup(legacy);
  expect(result.policies[0].phone).toBe("");
  expect(result.policies[0].followUp).toBe("pending");
  expect(result.profile.onboarded).toBe(true);
  expect(result.settings.pageSize).toBe(50);
});

for (const [name, mutate] of [
  ["missing insurer", (backup: ReturnType<typeof makeBackup>) => { delete (backup.policies[0] as Partial<typeof backup.policies[0]>).insurer; }],
  ["non-string phone", (backup: ReturnType<typeof makeBackup>) => { Object.assign(backup.policies[0], { phone: 123 }); }],
  ["impossible expiry", (backup: ReturnType<typeof makeBackup>) => { backup.policies[0].expiryDate = "2026-02-30"; }],
  ["start after expiry", (backup: ReturnType<typeof makeBackup>) => { backup.policies[0].startDate = "2027-01-01"; }],
  ["negative premium", (backup: ReturnType<typeof makeBackup>) => { backup.policies[0].premium = -1; }],
  ["non-finite premium", (backup: ReturnType<typeof makeBackup>) => { backup.policies[0].premium = Infinity; }],
  ["out-of-range premium", (backup: ReturnType<typeof makeBackup>) => { backup.policies[0].premium = 1e14; }],
  ["unknown follow-up", (backup: ReturnType<typeof makeBackup>) => { Object.assign(backup.policies[0], { followUp: "unknown" }); }],
  ["duplicate policy IDs", (backup: ReturnType<typeof makeBackup>) => { backup.policies[1].id = backup.policies[0].id; }],
  ["invalid timestamp", (backup: ReturnType<typeof makeBackup>) => { backup.policies[0].importedAt = "not-a-date"; }],
  ["impossible timestamp date", (backup: ReturnType<typeof makeBackup>) => { backup.policies[0].importedAt = "2026-02-30T12:00:00Z"; }],
  ["negative import count", (backup: ReturnType<typeof makeBackup>) => { backup.imports[0].added = -1; }],
  ["fractional source row", (backup: ReturnType<typeof makeBackup>) => { backup.policies[0].sourceRow = .5; }],
  ["unknown version", (backup: ReturnType<typeof makeBackup>) => { backup.version = 99; }],
] as const) {
  test(`rejects ${name} before restoring`, () => {
    const backup = makeBackup();
    mutate(backup);
    expect(() => parseBackup(backup)).toThrow();
  });
}

test("rejects invalid roots and import structures", () => {
  for (const value of [null, [], {}, { ...makeBackup(), imports: {} }, { ...makeBackup(), profile: [] }]) {
    expect(() => parseBackup(value)).toThrow();
  }
});

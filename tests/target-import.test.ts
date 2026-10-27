import assert from "node:assert/strict";
import test from "node:test";

import {
  dedupeTargets,
  parseTargetFile,
  parseTargetRow,
  splitCsvLine
} from "../scripts/lib/target-sources";

test("a complete JSON export parses", () => {
  const content = JSON.stringify({
    sources: [
      {
        name: "Nhóm A",
        url: "https://www.facebook.com/groups/a",
        source_type: "group",
        niche: "me_bim",
        scan_interval_mins: 30
      }
    ]
  });

  const result = parseTargetFile(content, "sources.json");
  assert.equal(result.issues.length, 0);
  assert.deepEqual(result.targets[0], {
    line: 1,
    name: "Nhóm A",
    url: "https://www.facebook.com/groups/a",
    source_type: "group",
    niche: "me_bim",
    tone_of_voice: null,
    group_rules: null,
    scan_interval_mins: 30,
    is_active: true
  });
});

test("a bare array is accepted too", () => {
  const result = parseTargetFile(
    JSON.stringify([{ name: "B", url: "https://x.test/b", source_type: "fanpage" }]),
    "b.json"
  );
  assert.equal(result.targets.length, 1);
});

test("a CSV with a quoted comma and a semicolon delimiter parses", () => {
  const csv = [
    "name;url;source_type;niche",
    '"Nhóm, có dấu phẩy";https://x.test/a;group;decor',
    "Page B;https://x.test/b;fanpage;"
  ].join("\n");

  const result = parseTargetFile(csv, "sources.csv");
  assert.equal(result.issues.length, 0);
  assert.equal(result.targets[0]?.name, "Nhóm, có dấu phẩy");
  assert.equal(result.targets[0]?.niche, "decor");
  assert.equal(result.targets[1]?.niche, null);
  assert.equal(result.targets[1]?.source_type, "fanpage");
});

test("a row missing a field is skipped with the reason and the line number", () => {
  const csv = ["name,url,source_type", "Good,https://x.test/ok,group", ",https://x.test/no-name,group"].join("\n");
  const result = parseTargetFile(csv, "sources.csv");

  assert.deepEqual(result.targets.map((target) => target.name), ["Good"]);
  assert.deepEqual(result.issues, [{ line: 3, error: "missing name" }]);
});

test("a bad url and a bad source_type are reported separately", () => {
  const csv = [
    "name,url,source_type,scan_interval_mins",
    "Bad url,ftp://x.test/a,group,15",
    "Bad type,https://x.test/b,podcast,15",
    "Bad interval,https://x.test/c,group,9999"
  ].join("\n");

  const result = parseTargetFile(csv, "sources.csv");
  assert.equal(result.targets.length, 0);
  assert.match(result.issues[0]?.error ?? "", /must start with http/);
  assert.match(result.issues[1]?.error ?? "", /source_type must be one of/);
});

test("an interval out of range is rejected", () => {
  const parsed = parseTargetRow(
    { name: "X", url: "https://x.test/x", source_type: "group", scan_interval_mins: 5000 },
    2
  );
  assert.ok("error" in parsed);
  assert.match(parsed.error, /1\.\.1440/);
});

test("booleans accept the strings a spreadsheet produces", () => {
  const base = { name: "X", url: "https://x.test/x", source_type: "group" };
  for (const value of ["false", "0", "no", "off", "INACTIVE"]) {
    const parsed = parseTargetRow({ ...base, is_active: value }, 2);
    assert.ok("target" in parsed);
    assert.equal(parsed.target.is_active, false, `"${value}" should be inactive`);
  }
  const truthy = parseTargetRow({ ...base, is_active: "true" }, 2);
  assert.ok("target" in truthy);
  assert.equal(truthy.target.is_active, true);
});

test("duplicate urls inside one file keep the first and report the rest", () => {
  const csv = [
    "name,url,source_type",
    "First,https://x.test/dup,group",
    "Second,https://x.test/DUP,fanpage"
  ].join("\n");

  const parsed = parseTargetFile(csv, "sources.csv");
  const { unique, duplicates } = dedupeTargets(parsed.targets);

  assert.equal(unique.length, 1);
  assert.equal(unique[0]?.name, "First");
  assert.deepEqual(duplicates, [{ line: 3, error: "duplicate url of line 2" }]);
});

test("invalid JSON fails with one clear issue instead of throwing", () => {
  const result = parseTargetFile("{nope", "x.json");
  assert.equal(result.targets.length, 0);
  assert.match(result.issues[0]?.error ?? "", /invalid JSON/);
});

test("the CSV splitter handles doubled quotes", () => {
  assert.deepEqual(splitCsvLine('a,"say ""hi""",c', ","), ["a", 'say "hi"', "c"]);
});

test("the bundled sample file parses cleanly", async () => {
  const { readFileSync } = await import("node:fs");
  const content = readFileSync("supabase/targets-sample.json", "utf8");
  const result = parseTargetFile(content, "supabase/targets-sample.json");

  assert.equal(result.issues.length, 0);
  assert.equal(result.targets.length, 3);
  assert.deepEqual(
    result.targets.map((target) => target.source_type).sort(),
    ["fanpage", "group", "group"]
  );
});

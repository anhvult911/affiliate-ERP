/**
 * Pre-commit secret scan.
 *
 *   npx tsx scripts/check-secrets.ts            # every tracked file
 *   npx tsx scripts/check-secrets.ts --staged   # what the commit would add
 *
 * Exit code 1 blocks the commit. The rules live in
 * `src/lib/security/secret-scan.ts` so they are unit-tested like any other logic.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { scanText, shouldScan } from "../src/lib/security/secret-scan";

function listFiles(staged: boolean): string[] {
  const args = staged
    ? ["diff", "--cached", "--name-only", "--diff-filter=ACMR"]
    : ["ls-files"];

  const output = execFileSync("git", args, { encoding: "utf8" });
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && shouldScan(line));
}

function main(): number {
  const staged = process.argv.includes("--staged");
  const files = listFiles(staged);

  if (files.length === 0) {
    console.log("secret scan: nothing to scan");
    return 0;
  }

  let blocked = 0;

  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue; // deleted between listing and reading
    }

    // Skip files that are not text.
    if (text.includes("\u0000")) continue;

    for (const finding of scanText(text)) {
      blocked += 1;
      console.error(`${file}:${finding.line}  ${finding.kind}  ${finding.preview}`);
    }
  }

  if (blocked > 0) {
    console.error(
      `\nsecret scan: ${blocked} finding(s). Remove the value (rotation is the account owner's job — see docs/REVIEW.md P0-1).\n` +
        "If the hit is genuinely documentation, add the marker: secret-scan:allow"
    );
    return 1;
  }

  console.log(`secret scan: ${files.length} file(s) clean`);
  return 0;
}

process.exit(main());

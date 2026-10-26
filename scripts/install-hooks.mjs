/**
 * Installs the pre-commit hook that runs the secret scan.
 *
 *   node scripts/install-hooks.mjs
 *
 * Deliberately a plain installer instead of Husky: one dependency less, and the
 * hook is visible in `.git/hooks/pre-commit` where anyone can read it.
 */
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const hookPath = resolve(process.cwd(), ".git", "hooks", "pre-commit");

if (!existsSync(resolve(process.cwd(), ".git"))) {
  console.error("Not a git repository — nothing installed.");
  process.exit(1);
}

const hook = `#!/bin/sh
# Blocks commits that contain account exports, TOTP secrets, API keys, JWTs or
# authenticated proxies. Installed by scripts/install-hooks.mjs.
if ! command -v npx >/dev/null 2>&1; then
  echo "secret scan skipped: npx not found" >&2
  exit 0
fi

# Branches cut before the scanner existed must still be committable; the scan runs
# again on every branch that has it.
if [ ! -f scripts/check-secrets.ts ]; then
  echo "secret scan skipped: scripts/check-secrets.ts not on this branch" >&2
  exit 0
fi

exec npx tsx scripts/check-secrets.ts --staged
`;

mkdirSync(resolve(process.cwd(), ".git", "hooks"), { recursive: true });
writeFileSync(hookPath, hook, "utf8");

try {
  chmodSync(hookPath, 0o755);
} catch {
  // Windows: the executable bit is not used, and git runs the hook anyway.
}

console.log(`Installed ${hookPath}`);
console.log("Run it now to make sure it works: pnpm check:secrets");

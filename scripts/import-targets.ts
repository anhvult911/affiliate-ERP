/**
 * Imports target sources from a JSON or CSV file (docs/TASKS.md P3-5).
 *
 *   npm run import:targets -- ./supabase/targets-sample.json
 *   npm run import:targets -- ./groups.csv
 *
 * Upserts by URL, so importing the same file twice updates instead of duplicating.
 * Rows that cannot be validated are skipped and listed with the reason; a 40-line export
 * with one typo still imports 39.
 */
import { existsSync, readFileSync } from "node:fs";

function loadEnvironment(): void {
  for (const file of [".env.production", ".env.local", ".env"]) {
    if (!existsSync(file)) continue;
    try {
      process.loadEnvFile(file);
      return;
    } catch {
      continue;
    }
  }
}

async function main(): Promise<number> {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: npm run import:targets -- <file.json|file.csv>");
    return 2;
  }

  if (!existsSync(path)) {
    console.error(`file not found: ${path}`);
    return 2;
  }

  loadEnvironment();

  const [{ createSupabaseAdminClient }, { dedupeTargets, parseTargetFile }] = await Promise.all([
    import("../src/lib/supabase/admin"),
    import("./lib/target-sources")
  ]);

  const parsed = parseTargetFile(readFileSync(path, "utf8"), path);
  const { unique, duplicates } = dedupeTargets(parsed.targets);
  const issues = [...parsed.issues, ...duplicates];

  console.log(`parsed ${parsed.targets.length + parsed.issues.length} row(s) from ${path}`);
  for (const issue of issues) console.log(`  skipped line ${issue.line}: ${issue.error}`);

  if (unique.length === 0) {
    console.log("\nnothing to import");
    return 1;
  }

  const db = createSupabaseAdminClient();
  let inserted = 0;
  let updated = 0;
  let failed = 0;

  for (const target of unique) {
    const { data: existing, error: findError } = await db
      .from("target_sources")
      .select("id")
      .eq("url", target.url)
      .maybeSingle();

    if (findError) {
      console.log(`  failed line ${target.line}: ${findError.message}`);
      failed += 1;
      continue;
    }

    const values = {
      name: target.name,
      url: target.url,
      source_type: target.source_type,
      niche: target.niche,
      tone_of_voice: target.tone_of_voice,
      group_rules: target.group_rules,
      scan_interval_mins: target.scan_interval_mins,
      is_active: target.is_active
    };

    if (existing) {
      const { error } = await db.from("target_sources").update(values).eq("id", existing.id);
      if (error) {
        console.log(`  failed line ${target.line}: ${error.message}`);
        failed += 1;
      } else {
        updated += 1;
      }
    } else {
      const { error } = await db.from("target_sources").insert(values);
      if (error) {
        console.log(`  failed line ${target.line}: ${error.message}`);
        failed += 1;
      } else {
        inserted += 1;
      }
    }
  }

  console.log(`\ninserted ${inserted} · updated ${updated} · skipped ${issues.length} · failed ${failed}`);
  return failed === 0 ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });

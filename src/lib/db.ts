import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * The one client shape both data paths satisfy.
 *
 * Server actions normally run as the signed-in operator (cookie client, RLS
 * enforced). The Telegram webhook has no session — it authenticates with the
 * bot's secret token instead — so it needs the service-role client. Naming the
 * type here is what lets the same action code serve both without duplicating the
 * business rules.
 */
export type SupabaseDb = SupabaseClient<Database>;

export async function resolveDb(client?: SupabaseDb): Promise<SupabaseDb> {
  return client ?? (await createSupabaseServerClient());
}

export function adminDb(): SupabaseDb {
  return createSupabaseAdminClient();
}

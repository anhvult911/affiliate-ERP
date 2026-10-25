import type { Tables } from "@/lib/database.types";

/** Client-safe account shape: no server-only imports, so the review panel can use it. */
export type AssignableAccount = Pick<
  Tables<"social_accounts">,
  "id" | "name" | "persona_type" | "status" | "trust_score" | "browser_profile_id" | "proxy_ip"
>;

/**
 * Default account for one-tap approval: the highest-trust active account whose
 * persona matches the product niche, else the highest-trust active account.
 * Accounts without a browser profile are skipped — the worker could not use them.
 */
export function pickDefaultAccount(
  accounts: AssignableAccount[],
  niche: string | null
): AssignableAccount | null {
  const usable = accounts.filter(
    (account) => account.status === "active" && account.browser_profile_id !== null
  );
  const sameNiche = niche ? usable.filter((account) => account.persona_type === niche) : [];

  return sameNiche[0] ?? usable[0] ?? null;
}

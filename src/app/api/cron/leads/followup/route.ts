import { NextResponse } from "next/server";

import { authorizeCron } from "@/lib/cron/auth";
import { adminDb, type SupabaseDb } from "@/lib/db";
import { LEAD_OWNER_ID } from "@/lib/leads/config";
import { sendFollowupDigest, type FollowupLead } from "@/lib/leads/notifier";

export const dynamic = "force-dynamic";

/**
 * GET|POST /api/cron/leads/followup
 *
 * The 09:00 Vietnam reminder (02:00 UTC): one digest of leads that were contacted
 * and are now due for a nudge. Only `replied` / `sent_freebie` qualify — a closed
 * or ignored lead must never reappear. Everything is scoped to the Phase 1 owner.
 *
 * The digest does not mutate lead rows: sending a reminder is not a contact, so
 * `last_contacted_at` / `next_followup_at` stay under the operator's control.
 */

const PAGE_SIZE = 200;

type DueLead = FollowupLead;

async function loadDueLeads(db: SupabaseDb, now: Date): Promise<DueLead[]> {
  const leads: DueLead[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db
      .from("leads")
      .select("id,group_name,post_url,score,matched_category,summary,status,notes,next_followup_at")
      .eq("user_id", LEAD_OWNER_ID)
      .in("status", ["replied", "sent_freebie"])
      .lte("next_followup_at", now.toISOString())
      .order("next_followup_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw new Error(error.message);

    const page = data ?? [];
    leads.push(
      ...page.map((row) => ({
        id: row.id,
        group_name: row.group_name ?? "không rõ",
        post_url: row.post_url,
        score: row.score,
        matched_category: row.matched_category,
        summary: row.summary,
        status: row.status,
        notes: row.notes,
        next_followup_at: row.next_followup_at
      }))
    );

    if (page.length < PAGE_SIZE) return leads;
  }
}

async function run(request: Request) {
  const auth = authorizeCron(request);
  if (!auth.ok) return auth.response;

  const now = new Date();

  try {
    const leads = await loadDueLeads(adminDb(), now);
    const result = await sendFollowupDigest(leads, { now });
    const payload = { ok: result.skipped === null && result.failed === 0, ...result };

    // The scheduler must see a non-2xx when leads were due but Telegram was not
    // configured or any page failed (partial failures included). No leads due is a
    // normal day: 200 with `messages: 0`.
    if (result.skipped) {
      return NextResponse.json(payload, { status: 503 });
    }
    if (result.failed > 0) {
      return NextResponse.json(payload, { status: 502 });
    }

    return NextResponse.json(payload);
  } catch (error) {
    console.error(
      "[cron] leads follow-up failed",
      error instanceof Error ? error.message : error
    );
    return NextResponse.json({ ok: false, error: "Failed to build or send the follow-up digest." }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;

import { NextResponse } from "next/server";

import { adminDb } from "@/lib/db";
import { authorizeCron } from "@/lib/cron/auth";
import { readDealPosterConfig } from "@/lib/deals/config";
import {
  buildDealPreview,
  resolveDealCaption,
  trimForTelegram,
  type DealProduct
} from "@/lib/deals/copy";
import { dealPreviewKeyboard } from "@/lib/deals/callbacks";
import { generateDealCaption } from "@/lib/deals/generate";
import { pickDealCandidates, type DealCandidateRow } from "@/lib/deals/selection";
import { isTelegramConfigured, sendToChat, telegramChatId } from "@/lib/telegram/api";

export const dynamic = "force-dynamic";

/**
 * GET|POST /api/cron/deal-poster
 *
 * Picks the best products that have not been posted recently and publishes them to the
 * Telegram deal channel. Scheduled twice a day (Vercel cron runs in UTC: `30 4,13 * * *`
 * is 11:30 and 20:30 in Vietnam).
 *
 * Modes:
 *   - `preview` (default) sends the caption to the operator chat with [Đăng] [Bỏ qua].
 *     Nothing reaches the channel until a human taps Đăng, and the exact caption shown is
 *     stored on the product so the button posts what was reviewed.
 *   - `auto` posts straight to the channel and marks the product dealt.
 *
 * Skipping is a 200 with a reason, never an error: a deployment without a channel yet must
 * not page anyone every 9 hours.
 */

const CANDIDATE_POOL = 50;

type ProductRow = DealCandidateRow & { niche: string | null };

async function run(request: Request) {
  const auth = authorizeCron(request);
  if (!auth.ok) return auth.response;

  const config = readDealPosterConfig();
  if (!config.channelId) {
    return NextResponse.json(
      {
        ok: true,
        skipped: "TELEGRAM_CHANNEL_ID_PENDING",
        hint: config.invalid ?? "Set TELEGRAM_CHANNEL_ID to @channelusername or -100… and make the bot an admin."
      },
      { headers: { "cache-control": "no-store" } }
    );
  }

  if (!isTelegramConfigured()) {
    return NextResponse.json(
      { ok: true, skipped: "TELEGRAM_NOT_CONFIGURED" },
      { headers: { "cache-control": "no-store" } }
    );
  }

  const db = adminDb();
  const { data, error } = await db
    .from("products")
    .select("id,name,price,commission_rate,affiliate_short_link,last_dealt_at,deal_previewed_at,niche")
    .eq("is_active", true)
    .not("affiliate_short_link", "is", null)
    .order("commission_rate", { ascending: false })
    .limit(CANDIDATE_POOL);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const now = new Date();
  const picked = pickDealCandidates((data ?? []) as ProductRow[], {
    now,
    perDay: config.perDay,
    mode: config.mode
  });

  if (picked.length === 0) {
    return NextResponse.json(
      { ok: true, mode: config.mode, considered: data?.length ?? 0, posted: 0, previewed: 0, skipped: "NO_CANDIDATES" },
      { headers: { "cache-control": "no-store" } }
    );
  }

  const operatorChat = telegramChatId();
  let posted = 0;
  let previewed = 0;
  const failures: string[] = [];

  for (const product of picked) {
    const generated = await generateDealCaption(product);
    const caption = resolveDealCaption(product as DealProduct, generated);

    if (config.mode === "auto") {
      const sent = await sendToChat(config.channelId, trimForTelegram(caption));
      if (!sent) {
        failures.push(`${product.id}: Telegram refused the post (is the bot an admin of ${config.channelId}?)`);
        continue;
      }

      await db
        .from("products")
        .update({ last_dealt_at: now.toISOString(), deal_caption: caption })
        .eq("id", product.id);
      posted += 1;
      continue;
    }

    if (!operatorChat) {
      failures.push("TELEGRAM_CHAT_ID is required in preview mode");
      break;
    }

    const sent = await sendToChat(operatorChat, buildDealPreview(caption), dealPreviewKeyboard(product.id));

    if (!sent) {
      failures.push(`${product.id}: could not reach the operator chat`);
      continue;
    }

    // previewed_at, not last_dealt_at: nothing was published, but the evening run must not
    // ask about the same product again.
    await db
      .from("products")
      .update({ deal_previewed_at: now.toISOString(), deal_caption: caption })
      .eq("id", product.id);
    previewed += 1;
  }

  return NextResponse.json(
    {
      ok: true,
      mode: config.mode,
      channel: config.channelId,
      considered: data?.length ?? 0,
      picked: picked.length,
      posted,
      previewed,
      ...(failures.length > 0 ? { failures } : {})
    },
    { headers: { "cache-control": "no-store" } }
  );
}

export const GET = run;
export const POST = run;

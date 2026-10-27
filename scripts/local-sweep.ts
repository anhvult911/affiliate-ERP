/**
 * Throwaway local integration sweep (no UI login): every worker/cron/postback route the
 * deployment depends on, plus the analytics RPCs, against the running local stack.
 *
 * Prints PASS/FAIL with timings and masked identifiers only.
 */
import { loadScriptEnv, LOCAL_ENV_FILES } from "./lib/env";

loadScriptEnv(LOCAL_ENV_FILES);

const BASE = "http://localhost:3000";
const WORKER = process.env.WORKER_API_TOKEN?.trim() ?? "";
const CRON = process.env.CRON_SECRET?.trim() || WORKER;
const SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") ?? "";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

type Result = { name: string; ok: boolean; skipped?: boolean; detail: string; ms: number };
const results: Result[] = [];

/** A check that could not run because an external service is down — not a code failure. */
class SkipCheck extends Error {}

async function skip(name: string, reason: string): Promise<void> {
  results.push({ name, ok: true, skipped: true, detail: reason, ms: 0 });
}

/**
 * `attempts` exists for the AI checks: the model chain already retries inside the app, but
 * a 30-second upstream outage can still outlast one call. A retryable 503 is retried once
 * and only then reported as SKIP — an app bug would surface as a non-retryable failure.
 */
async function check(name: string, run: () => Promise<string>, attempts = 1): Promise<void> {
  const started = Date.now();
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const detail = await run();
      results.push({ name, ok: true, detail, ms: Date.now() - started });
      return;
    } catch (error) {
      if (error instanceof SkipCheck) {
        if (attempt < attempts) continue;
        results.push({ name, ok: true, skipped: true, detail: error.message, ms: Date.now() - started });
        return;
      }
      results.push({
        name,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
        ms: Date.now() - started
      });
      return;
    }
  }
}

function workerHeaders(): Record<string, string> {
  return { "content-type": "application/json", authorization: `Bearer ${WORKER}` };
}

function cronHeaders(): Record<string, string> {
  return { "content-type": "application/json", authorization: `Bearer ${CRON}` };
}

/**
 * Route payloads are heterogeneous and each check narrows exactly the field it reads, so
 * the default is permissive; call sites that want a type pass one (`json<{ ok: boolean }>`).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function json<T = any>(response: Response): Promise<T> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`non-JSON body (HTTP ${response.status}): ${text.slice(0, 120)}`);
  }
}

function db(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${SUPABASE}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE,
      authorization: `Bearer ${SERVICE}`,
      "content-type": "application/json",
      ...(init.headers ?? {})
    }
  });
}

async function main(): Promise<number> {
  const stamp = Date.now();
  const postUrl = `https://www.facebook.com/groups/local-sweep/posts/${stamp}`;
  const orderId = `sweep-order-${stamp}`;

  let sourceId = "";
  let productId = "";
  let taskId = "";
  let subId = "";
  let autoPostUrl = "";
  let draftPostUrl = "";
  let noisePostUrl = "";

  /* ---------------------------------------------------------- data access */
  await check("service role can read accounts", async () => {
    const response = await db("social_accounts?select=id&limit=1");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const rows = await json(response);
    return `${rows.length} row via service role`;
  });

  await check("anon key cannot read accounts (RLS)", async () => {
    const response = await fetch(`${SUPABASE}/rest/v1/social_accounts?select=id`, {
      headers: { apikey: ANON, authorization: `Bearer ${ANON}` }
    });
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length !== 0) {
      throw new Error(`anon saw ${Array.isArray(rows) ? rows.length : "an error"} row(s)`);
    }
    return "0 rows for anon";
  });

  /* ------------------------------------------------------------- fixtures */
  await check("seed a source + product for the sweep", async () => {
    const sourceResponse = await db("target_sources", {
      method: "POST",
      headers: { prefer: "return=representation,resolution=merge-duplicates" },
      body: JSON.stringify({
        name: `Local sweep ${stamp}`,
        url: `https://www.facebook.com/groups/local-sweep`,
        source_type: "group",
        niche: "me_bim",
        scan_interval_mins: 15,
        is_active: true
      })
    });
    const [source] = await json(sourceResponse);
    sourceId = source?.id;

    const productResponse = await db("products?on_conflict=shopee_item_id", {
      method: "POST",
      headers: { prefer: "return=representation,resolution=merge-duplicates" },
      body: JSON.stringify({
        name: "Local sweep product",
        shopee_item_id: "local-sweep-1",
        affiliate_short_link: "https://s.shopee.vn/local-sweep",
        origin_link: "https://shopee.vn/local-sweep",
        price: 150_000,
        commission_rate: 10,
        niche: "me_bim",
        is_active: true
      })
    });
    const [product] = await json(productResponse);
    productId = product?.id;

    if (!sourceId || !productId) throw new Error("could not create fixtures");
    return `source ${sourceId.slice(0, 8)} · product ${productId.slice(0, 8)}`;
  });

  /* --------------------------------------------------------------- radar */
  await check("GET /api/worker/accounts/scan", async () => {
    const response = await fetch(`${BASE}/api/worker/accounts/scan?limit=1`, { headers: workerHeaders() });
    const body = await json(response);
    if (!response.ok || !body.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
    return `${body.accounts.length} account(s) offered`;
  });

  await check("GET /api/worker/radar/sources", async () => {
    const response = await fetch(`${BASE}/api/worker/radar/sources?limit=3`, { headers: workerHeaders() });
    const body = await json(response);
    if (!response.ok || !body.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
    return `${body.sources.length} source(s) due`;
  });

  await check("POST /api/worker/radar/ingest (pinned product)", async () => {
    const response = await fetch(`${BASE}/api/worker/radar/ingest`, {
      method: "POST",
      headers: workerHeaders(),
      body: JSON.stringify({
        sourceId,
        postUrl,
        postContent: "Sweep: ai biết món này dùng ổn không?",
        postImages: [],
        productId
      })
    });
    const body = await json(response);
    if (!response.ok || !body.created) throw new Error(body.error ?? `not created (HTTP ${response.status})`);
    taskId = body.taskId;
    return `task ${taskId.slice(0, 8)} created`;
  });

  await check("POST /api/worker/radar/ingest is idempotent", async () => {
    const response = await fetch(`${BASE}/api/worker/radar/ingest`, {
      method: "POST",
      headers: workerHeaders(),
      body: JSON.stringify({ sourceId, postUrl, postContent: "dup", postImages: [], productId })
    });
    const body = await json(response);
    if (!body.duplicate) throw new Error(`expected duplicate, got ${JSON.stringify(body).slice(0, 100)}`);
    return "duplicate reported, no second task";
  });

  await check("POST /api/worker/radar/scanned records the scan", async () => {
    const response = await fetch(`${BASE}/api/worker/radar/scanned`, {
      method: "POST",
      headers: workerHeaders(),
      body: JSON.stringify({ sourceId, postsSeen: 1 })
    });
    const body = await json(response);
    if (!response.ok || !body.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
    return `empty streak now ${body.emptyStreak}`;
  });

  /* ------------------------------------------------------------ approval */
  await check("approval (library) mints a sub_id", async () => {
    const { approveTaskWithDefaults } = await import("../src/lib/actions/comment-tasks");
    const { createSupabaseAdminClient } = await import("../src/lib/supabase/admin");

    // The action needs a draft to approve.
    await db(`comment_tasks?id=eq.${taskId}`, {
      method: "PATCH",
      body: JSON.stringify({ ai_draft_comment: "Mình đang dùng món này, ổn trong tầm giá." })
    });

    let note = "";
    try {
      const result = await approveTaskWithDefaults(taskId, createSupabaseAdminClient());
      if (!result.ok) throw new Error(result.error);
      subId = result.data.subIdCode;
    } catch (error) {
      // Server actions end with revalidatePath(), which throws without a request context.
      // The database write already happened, so the effect is verified below.
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("static generation store missing")) throw error;
      note = " (revalidatePath skipped: no request context)";
    }

    const [row] = await json(await db(`comment_tasks?select=status,sub_id_code&id=eq.${taskId}`));
    if (row?.status !== "queued" || !row?.sub_id_code) {
      throw new Error(`expected queued with a sub_id, got ${row?.status}/${row?.sub_id_code ?? "none"}`);
    }
    subId = row.sub_id_code;
    return `queued · sub_id ${subId}${note}`;
  });

  /* --------------------------------------------------------- claim/report */
  let accountId = "";
  let accountBefore: { last_action_at: string | null; cooldown_until: string | null } | null = null;

  await check("clear the per-account action gap (fixture)", async () => {
    const [task] = await json(
      await db(`comment_tasks?select=assigned_account_id&id=eq.${taskId}`)
    );
    accountId = task?.assigned_account_id ?? "";
    if (!accountId) throw new Error("the task has no assigned account");

    const [account] = await json(
      await db(`social_accounts?select=last_action_at,cooldown_until&id=eq.${accountId}`)
    );
    accountBefore = {
      last_action_at: account?.last_action_at ?? null,
      cooldown_until: account?.cooldown_until ?? null
    };

    const response = await db(`social_accounts?id=eq.${accountId}`, {
      method: "PATCH",
      body: JSON.stringify({ last_action_at: null, cooldown_until: null })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return "gap and cooldown cleared for a repeatable claim";
  });
  await check("POST /api/worker/tasks/claim", async () => {
    const response = await fetch(`${BASE}/api/worker/tasks/claim`, {
      method: "POST",
      headers: workerHeaders(),
      body: JSON.stringify({ worker: "local-sweep", limit: 5 })
    });
    const body = await json(response);
    if (!response.ok || !body.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
    const claimed = body.tasks.find((task: { taskId: string }) => task.taskId === taskId);
    if (!claimed) throw new Error(`our task was not claimed (${body.tasks.length} other task(s))`);
    if (!claimed.product?.trackedAffiliateUrl) throw new Error("claimed without a tracked affiliate URL");
    if (!claimed.product.trackedAffiliateUrl.includes(subId)) throw new Error("tracked URL lost the sub_id");
    return `claimed · ${claimed.comment.length} chars · tracked link carries ${subId}`;
  });

  await check("POST /api/worker/tasks/{id}/report completes it", async () => {
    // Read the account from the task, never "the first active account". Approval assigns
    // the best persona (or the operator's pick), and the report route bumps trust on
    // `assigned_account_id` — so watching an unordered `status=eq.active&limit=1` row made
    // this check depend on heap order and it failed once as "44 -> 44" while the assigned
    // account had in fact moved.
    const [assigned] = await json(
      await db(`comment_tasks?select=assigned_account_id,secondary_account_id,execution_mode&id=eq.${taskId}`)
    );
    if (!assigned?.assigned_account_id) throw new Error("the task has no assigned account");
    if (assigned.assigned_account_id !== accountId) {
      throw new Error("the task is assigned to a different account than the one claimed for");
    }

    const [before] = await json(
      await db(`social_accounts?select=id,trust_score&id=eq.${assigned.assigned_account_id}`)
    );
    if (!before) throw new Error("the assigned account disappeared");

    const [secondaryBefore] = assigned.secondary_account_id
      ? await json(await db(`social_accounts?select=trust_score&id=eq.${assigned.secondary_account_id}`))
      : [null];

    const response = await fetch(`${BASE}/api/worker/tasks/${taskId}/report`, {
      method: "POST",
      headers: workerHeaders(),
      body: JSON.stringify({ worker: "local-sweep", status: "completed" })
    });
    const body = await json(response);
    if (!response.ok || !body.ok) throw new Error(body.error ?? `HTTP ${response.status}`);

    const [task] = await json(await db(`comment_tasks?select=status,executed_at&id=eq.${taskId}`));
    if (task.status !== "completed" || !task.executed_at) {
      throw new Error(`task is ${task.status}, executed_at ${task.executed_at ?? "null"}`);
    }

    const [after] = await json(await db(`social_accounts?select=trust_score&id=eq.${before.id}`));
    if (after.trust_score <= before.trust_score) {
      throw new Error(`trust did not move on the assigned account: ${before.trust_score} -> ${after.trust_score}`);
    }

    // Seeding mode pays the tier-2 persona too; a single-mode task must not.
    if (secondaryBefore) {
      const [secondaryAfter] = await json(
        await db(`social_accounts?select=trust_score&id=eq.${assigned.secondary_account_id}`)
      );
      if (secondaryAfter.trust_score <= secondaryBefore.trust_score) {
        throw new Error(
          `tier-2 trust did not move: ${secondaryBefore.trust_score} -> ${secondaryAfter.trust_score}`
        );
      }
      return `completed · trust ${before.trust_score} -> ${after.trust_score} (tier-2 ${secondaryBefore.trust_score} -> ${secondaryAfter.trust_score})`;
    }

    return `completed · executed_at set · trust ${before.trust_score} -> ${after.trust_score}`;
  });

  /* ------------------------------------------------------------- postback */
  await check("POST /api/postback/shopee attributes the order", async () => {
    const response = await fetch(`${BASE}/api/postback/shopee`, {
      method: "POST",
      headers: workerHeaders(),
      body: JSON.stringify({
        sub_id: subId,
        order_id: orderId,
        order_amount: 150_000,
        estimated_commission: 15_000,
        status: "pending"
      })
    });
    const body = await json(response);
    if (!response.ok || !body.attributed) throw new Error(body.error ?? "not attributed");
    return "conversion stored and linked to the task";
  });

  await check("postback replay does not double-count", async () => {
    const response = await fetch(`${BASE}/api/postback/shopee`, {
      method: "POST",
      headers: workerHeaders(),
      body: JSON.stringify({ sub_id: subId, order_id: orderId, status: "settled" })
    });
    const body = await json(response);
    const after = await json(await db(`affiliate_conversions?select=id,status&external_order_id=eq.${orderId}`));
    if (after.length !== 1) throw new Error(`expected 1 row, got ${after.length}`);
    if (after[0].status !== "settled") throw new Error(`status did not move forward: ${after[0].status}`);
    return `1 row · status ${after[0].status} (was ${body.updated ? "merged" : "?"})`;
  });

  await check("POST /api/cron/reconcile", async () => {
    const response = await fetch(`${BASE}/api/cron/reconcile`, { method: "POST", headers: cronHeaders() });
    const body = await json(response);
    if (!response.ok || !body.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
    return `attributed ${body.attributed}, remaining ${body.remaining}`;
  });

  await check("cron route rejects the worker token when CRON_SECRET is set", async () => {
    const response = await fetch(`${BASE}/api/cron/reconcile`, {
      method: "POST",
      headers: { authorization: `Bearer ${WORKER}` }
    });
    if (CRON !== WORKER && response.status !== 401) throw new Error(`expected 401, got ${response.status}`);
    return CRON !== WORKER ? "401 as designed" : "skipped (CRON_SECRET == worker token)";
  });

  /* ------------------------------------------------------------ analytics */
  await check("analytics RPCs answer", async () => {
    const summary = await json(await db("rpc/analytics_summary", { method: "POST", body: "{}" }));
    const roi = await json(await db("rpc/analytics_task_roi", { method: "POST", body: "{}" }));
    if (!Array.isArray(summary) || summary.length === 0) throw new Error("empty summary");
    if (!Array.isArray(roi)) throw new Error("roi is not a list");
    return `summary orders ${summary[0].orders} · roi rows ${roi.length}`;
  });

  await check("task ROI includes the completed task", async () => {
    const rows = await json(await db(`v_task_roi?select=task_id,revenue,commission&task_id=eq.${taskId}`));
    if (rows.length !== 1) throw new Error(`expected 1 roi row, got ${rows.length}`);
    return `revenue ${rows[0].revenue} · commission ${rows[0].commission}`;
  });

  /* ------------------------------------------------------------------- AI */
  const geminiConfigured = Boolean(process.env.GEMINI_API_KEY?.trim());

  if (!geminiConfigured) {
    await skip("POST /api/worker/products/embed", "GEMINI_API_KEY not configured");
    await skip("radar auto-match (no pinned product)", "GEMINI_API_KEY not configured");
    await skip("radar drafts a comment", "GEMINI_API_KEY not configured");
    await skip("radar rejects off-topic posts and caches it", "GEMINI_API_KEY not configured");
  } else {
    await check("POST /api/worker/products/embed backfills embeddings", async () => {
      const response = await fetch(`${BASE}/api/worker/products/embed`, {
        method: "POST",
        headers: workerHeaders(),
        body: JSON.stringify({})
      });
      const body = await json(response);
      if (!response.ok || !body.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      if (body.failures?.length) throw new Error(`${body.failures.length} embedding(s) failed`);
      return `embedded ${body.embedded}, remaining ${body.remaining}`;
    });

    const autoUrl = `https://www.facebook.com/groups/me-bim-vn/posts/auto-${stamp}`;
    autoPostUrl = autoUrl;

    await check("radar auto-match (no pinned product)", async () => {
      const response = await fetch(`${BASE}/api/worker/radar/ingest`, {
        method: "POST",
        headers: workerHeaders(),
        body: JSON.stringify({
          sourceId,
          postUrl: autoUrl,
          postContent:
            "Mình đang tìm máy hút sữa điện đôi cầm tay, ai dùng rồi cho xin review với ạ. Bé nhà mình 3 tháng.",
          postImages: []
        })
      });
      const body = await json(response);
      if (body.retryable) throw new SkipCheck(`model unavailable, ingest answered 503: ${body.error}`);
      if (!body.created) throw new Error(`not created: ${JSON.stringify(body).slice(0, 140)}`);
      if (body.score < Number(process.env.RADAR_MATCH_THRESHOLD ?? 0.8)) {
        throw new Error(`score ${body.score} below the threshold`);
      }
      const [row] = await json(
        await db(`comment_tasks?select=matched_product_id,ai_draft_comment&id=eq.${body.taskId}`)
      );
      if (!row?.matched_product_id) throw new Error("no product was matched");
      if (row.ai_draft_comment) throw new Error("a draft was generated without draft:true");
      return `score ${body.score} · matched · no draft unless asked`;
    }, 2);

    await check("radar drafts a comment", async () => {
      const draftUrl = autoUrl.replace("/auto-", "/draft-");
      draftPostUrl = draftUrl;
      const response = await fetch(`${BASE}/api/worker/radar/ingest`, {
        method: "POST",
        headers: workerHeaders(),
        body: JSON.stringify({
          sourceId,
          postUrl: draftUrl,
          postContent:
            "Có mẹ nào dùng máy hút sữa điện đôi chưa? Mình đang phân vân giữa vài loại, muốn hỏi kinh nghiệm thực tế.",
          postImages: [],
          draft: true
        })
      });
      const body = await json(response);
      if (body.retryable) throw new SkipCheck(`model unavailable, ingest answered 503: ${body.error}`);
      if (!body.created) throw new Error(`not created: ${JSON.stringify(body).slice(0, 140)}`);
      if (!body.drafted) throw new Error(`no draft: ${JSON.stringify(body).slice(0, 140)}`);
      const [row] = await json(
        await db(`comment_tasks?select=ai_draft_comment&id=eq.${body.taskId}`)
      );
      const draft = row?.ai_draft_comment ?? "";
      if (draft.length < 40) throw new Error(`draft looks empty: ${draft.length} chars`);
      return `${draft.length} chars: "${draft.slice(0, 46)}…"`;
    }, 2);

    await check("radar rejects off-topic posts and caches it", async () => {
      const noiseUrl = `https://www.facebook.com/groups/me-bim-vn/posts/noise-${stamp}`;
      noisePostUrl = noiseUrl;
      const send = () =>
        fetch(`${BASE}/api/worker/radar/ingest`, {
          method: "POST",
          headers: workerHeaders(),
          body: JSON.stringify({
            sourceId,
            postUrl: noiseUrl,
            postContent: "Hôm nay trời đẹp quá, cả nhà đi cà phê nhé.",
            postImages: []
          })
        });

      const first = await json(await send());
      if (first.retryable) throw new SkipCheck(`model unavailable, ingest answered 503: ${first.error}`);
      if (first.created || !first.belowThreshold) throw new Error("an off-topic post was accepted");

      const started = Date.now();
      const second = await json(await send());
      if (!second.cached) throw new Error("the second call was not served from the seen cache");
      return `below threshold (${first.score}) · re-scan ${Date.now() - started}ms from cache`;
    }, 2);
  }

  /* --------------------------------------------------- warming + health */
  await check("GET /api/worker/warming/due", async () => {
    const response = await fetch(`${BASE}/api/worker/warming/due`, { headers: workerHeaders() });
    const body = await json(response);
    if (!response.ok || !body.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
    return `${body.slots.length} slot(s) due`;
  });

  await check("GET /api/cron/health sweeps and reports", async () => {
    const response = await fetch(`${BASE}/api/cron/health`, { headers: cronHeaders() });
    const body = await json(response);
    if (!response.ok || !body.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
    return `status ${body.status} · swept ${body.swept ?? 0}`;
  });

  await check("worker routes reject a bad token", async () => {
    const response = await fetch(`${BASE}/api/worker/radar/sources`, {
      headers: { authorization: "Bearer wrong-token" }
    });
    if (response.status !== 401) throw new Error(`expected 401, got ${response.status}`);
    return "401";
  });

  /* --------------------------------------------------------------- output */
  console.log("");
  for (const result of results) {
    const label = result.skipped ? "SKIP" : result.ok ? "PASS" : "FAIL";
    const timing = result.skipped ? "     " : `${String(result.ms).padStart(5)}ms`;
    console.log(`${label}  ${result.name.padEnd(52)} ${timing}  ${result.detail}`);
  }

  const failed = results.filter((result) => !result.ok).length;
  const skipped = results.filter((result) => result.skipped).length;
  console.log(`\n${results.length - failed - skipped}/${results.length} passed${skipped ? ` · ${skipped} skipped` : ""}`);

  const chain = { sourceId, productId, taskId, subId, orderId };
  console.log("\nchain:", JSON.stringify(chain));

  // Leave the database as found.
  for (const url of [postUrl, autoPostUrl, draftPostUrl, noisePostUrl].filter(Boolean)) {
    await db(`comment_tasks?post_url=eq.${encodeURIComponent(url)}`, { method: "DELETE" });
    await db(`radar_seen?post_url=eq.${encodeURIComponent(url)}`, { method: "DELETE" });
  }
  await db(`affiliate_conversions?external_order_id=eq.${orderId}`, { method: "DELETE" });
  await db(`target_sources?id=eq.${sourceId}`, { method: "DELETE" });
  if (accountId && accountBefore) {
    await db(`social_accounts?id=eq.${accountId}`, {
      method: "PATCH",
      body: JSON.stringify(accountBefore)
    });
  }

  return failed === 0 ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error("sweep crashed:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  });

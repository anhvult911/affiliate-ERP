/**
 * End-to-end demo on the LOCAL stack (docs/TASKS.md P3-3).
 *
 *   npm run demo:e2e
 *
 * Proves the whole loop with real code paths, no browser and no external AI:
 *
 *   source → capture (pinned product) → approval (sub_id minted) → claim → report
 *   → postback → reconcile → report query
 *
 * Two deliberate choices:
 *   - the AI match is bypassed by pinning a product, so the demo runs offline and costs
 *     nothing; the match path itself is covered by the fixture tests;
 *   - state from a previous run is deleted first, so running it twice is safe.
 */
import { loadScriptEnv, LOCAL_ENV_FILES } from "./lib/env";
import { cronAuthHeaders, workerAuthHeaders } from "./lib/tokens";

type Supabase = ReturnType<typeof import("../src/lib/supabase/admin").createSupabaseAdminClient>;

const DEMO_POST_URL = "https://www.facebook.com/groups/demo-e2e/posts/1";
const DEMO_SOURCE_URL = "https://www.facebook.com/groups/demo-e2e";
const DEMO_ITEM_ID = "demo-e2e-product-1";
const DEMO_ORDER_ID = "demo-e2e-order-1";
const DEMO_LATE_ORDER_ID = "demo-e2e-order-late";

function loadEnvironment(): void {
  loadScriptEnv(LOCAL_ENV_FILES);
}

function step(label: string): void {
  process.stdout.write(`\n▸ ${label}\n`);
}

function ok(detail: string): void {
  process.stdout.write(`  ✓ ${detail}\n`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// The demo calls two differently-gated route families, so it must send the matching
// token: server-to-server helpers live in scripts/lib/tokens.ts.

/** Removes only the rows this demo creates, so a second run starts from the same state. */
async function resetDemoState(db: Supabase): Promise<void> {
  await db.from("affiliate_conversions").delete().in("external_order_id", [DEMO_ORDER_ID, DEMO_LATE_ORDER_ID]);
  await db.from("comment_tasks").delete().eq("post_url", DEMO_POST_URL);
  await db.from("radar_seen").delete().eq("post_url", DEMO_POST_URL);
}

async function ensureSource(db: Supabase): Promise<string> {
  const { data: existing, error: findError } = await db
    .from("target_sources")
    .select("id")
    .eq("url", DEMO_SOURCE_URL)
    .maybeSingle();

  if (findError) throw new Error(`target_sources lookup failed: ${findError.message}`);
  if (existing) return existing.id;

  const { data: created, error } = await db
    .from("target_sources")
    .insert({
      name: "Demo E2E group",
      url: DEMO_SOURCE_URL,
      source_type: "group",
      niche: "me_bim",
      scan_interval_mins: 15,
      is_active: true
    })
    .select("id")
    .single();

  if (error) throw new Error(`target_sources insert failed: ${error.message}`);
  return created.id;
}

async function ensureProduct(db: Supabase): Promise<string> {
  const { data: existing, error: findError } = await db
    .from("products")
    .select("id")
    .eq("shopee_item_id", DEMO_ITEM_ID)
    .maybeSingle();

  if (findError) throw new Error(`products lookup failed: ${findError.message}`);
  if (existing) return existing.id;

  const { data: created, error } = await db
    .from("products")
    .insert({
      name: "Sản phẩm demo E2E",
      shopee_item_id: DEMO_ITEM_ID,
      affiliate_short_link: "https://s.shopee.vn/demo-e2e",
      origin_link: "https://shopee.vn/demo-e2e",
      price: 199_000,
      commission_rate: 10,
      niche: "me_bim",
      sync_source: "csv",
      is_active: true
    })
    .select("id")
    .single();

  if (error) throw new Error(`products insert failed: ${error.message}`);
  return created.id;
}

async function main(): Promise<number> {
  loadEnvironment();

  // The demo deletes the rows it created, so it must never run against a real project
  // by accident. Local hosts only, unless someone opts in explicitly.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const host = (() => {
    try {
      return new URL(supabaseUrl).hostname;
    } catch {
      return "";
    }
  })();
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (!isLocal && process.env.DEMO_ALLOW_REMOTE !== "true") {
    throw new Error(
      `Refusing to run against ${host || "(no NEXT_PUBLIC_SUPABASE_URL)"}: this demo deletes rows it created. ` +
        "Point it at the local stack, or set DEMO_ALLOW_REMOTE=true if that is really what you want."
    );
  }

  const [{ createSupabaseAdminClient }, ingestRoute, reportRoute, postbackRoute, reconcileRoute, actions] =
    await Promise.all([
      import("../src/lib/supabase/admin"),
      import("../src/app/api/worker/radar/ingest/route"),
      import("../src/app/api/worker/tasks/[id]/report/route"),
      import("../src/app/api/postback/shopee/route"),
      import("../src/app/api/cron/reconcile/route"),
      import("../src/lib/actions/comment-tasks")
    ]);

  const db = createSupabaseAdminClient();

  step("1/7 seed a source and a product");
  await resetDemoState(db);
  const sourceId = await ensureSource(db);
  const productId = await ensureProduct(db);
  ok(`source ${sourceId.slice(0, 8)} · product ${productId.slice(0, 8)}`);

  step("2/7 radar capture (pinned product, no AI, no browser)");
  const ingest = await ingestRoute.POST(
    new Request("http://localhost/api/worker/radar/ingest", {
      method: "POST",
      headers: workerAuthHeaders(),
      body: JSON.stringify({
        sourceId,
        postUrl: DEMO_POST_URL,
        postContent: "Demo: mình đang tìm hiểu sản phẩm này, có ai dùng chưa?",
        postImages: [],
        productId,
        draft: false
      })
    })
  );
  const ingestBody = (await ingest.json()) as { ok: boolean; created?: boolean; taskId?: string; error?: string };
  assert(ingestBody.created && ingestBody.taskId, `ingest failed: ${ingestBody.error ?? "no task created"}`);
  const taskId = ingestBody.taskId;
  ok(`task ${taskId.slice(0, 8)} pending_approval`);

  // The approval flow requires a draft to approve. Asking Gemini would make the demo
  // depend on a network call (and on a model being free), so the draft is written
  // directly here; AI drafting itself is covered by `npm run smoke`.
  const demoDraft = "Mình cũng đang tìm hiểu món này, nghe ổn trong tầm giá. Bạn dùng thử chưa?";
  const { error: draftError } = await db
    .from("comment_tasks")
    .update({ ai_draft_comment: demoDraft })
    .eq("id", taskId);

  assert(!draftError, `could not attach the demo draft: ${draftError?.message}`);
  ok("draft attached (fixed text, no AI call)");

  step("3/7 approval flow (library call — sub_id minted)");
  try {
    const approval = await actions.approveTaskWithDefaults(taskId, db);
    assert(approval.ok, `approval failed: ${approval.ok ? "" : approval.error}`);
  } catch (error) {
    // Server actions finish with revalidatePath(), which needs a request context and
    // throws outside Next. The database write has already happened, so the assertions
    // below verify the effect rather than the return value. (Extracting the DB core out
    // of the action is the clean long-term fix; tracked as a follow-up, not done here to
    // keep this PR to the demo.)
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("static generation store missing")) throw error;
    process.stdout.write("  (revalidatePath skipped: no request context)\n");
  }

  const { data: approved } = await db
    .from("comment_tasks")
    .select("status,sub_id_code,assigned_account_id")
    .eq("id", taskId)
    .maybeSingle();

  assert(approved?.status === "queued", `expected queued, got ${approved?.status}`);
  const subId = approved.sub_id_code;
  assert(subId, "approval did not mint a sub_id");
  ok(`queued with sub_id ${subId} on account ${approved?.assigned_account_id?.slice(0, 8)}`);

  const accountId = approved.assigned_account_id as string;
  const { data: beforeAccount } = await db
    .from("social_accounts")
    .select("trust_score,last_action_at")
    .eq("id", accountId)
    .maybeSingle();
  const trustBefore = beforeAccount?.trust_score ?? 0;
  const lastActionBefore = beforeAccount?.last_action_at ?? null;

  step("4/7 claim + complete (real worker routes, in-process)");
  // The completion below moves trust and last_action_at on a real account. The demo
  // restores both when it finishes (or fails), so a second run starts from the same
  // state — otherwise the 20-minute action gap blocks the next claim.
  try {
  // The claim enforces the same 20-minute gap the worker lives with. A demo must run on
  // demand, so the timestamp is cleared for this one claim and restored in the finally
  // below — nothing is invented, the original value comes back unchanged.
  await db.from("social_accounts").update({ last_action_at: null }).eq("id", accountId);

  const { data: claimed, error: claimError } = await db.rpc("claim_comment_tasks", {
    p_worker: "demo-e2e",
    p_limit: 5
  });
  assert(!claimError, `claim failed: ${claimError?.message}`);
  const claimedRows = (claimed ?? []) as { id: string }[];
  assert(
    claimedRows.some((row) => row.id === taskId),
    `the demo task was not claimable (got ${claimedRows.length} task(s))`
  );

  const report = await reportRoute.POST(
    new Request(`http://localhost/api/worker/tasks/${taskId}/report`, {
      method: "POST",
      headers: workerAuthHeaders(),
      body: JSON.stringify({
        status: "completed",
        worker: "demo-e2e",
        note: "demo"
      })
    }),
    { params: Promise.resolve({ id: taskId }) }
  );
  assert(report.ok, `report failed with HTTP ${report.status}: ${await report.text()}`);

  const { data: afterAccount } = await db
    .from("social_accounts")
    .select("trust_score")
    .eq("id", accountId)
    .maybeSingle();
  assert(
    (afterAccount?.trust_score ?? 0) === Math.min(100, trustBefore + 1),
    `trust did not move by exactly one (${trustBefore} → ${afterAccount?.trust_score})`
  );

  const { data: completedTask } = await db
    .from("comment_tasks")
    .select("status,executed_at")
    .eq("id", taskId)
    .maybeSingle();
  assert(completedTask?.status === "completed", `expected completed, got ${completedTask?.status}`);
  const executedDrift = Math.abs(Date.now() - new Date(completedTask.executed_at as string).getTime());
  assert(executedDrift < 5 * 60_000, `executed_at is not server time (drift ${executedDrift}ms)`);
  ok(`completed · trust ${trustBefore} → ${afterAccount?.trust_score} · executed_at server-side`);

  step("5/7 postback replay (signed with the worker token)");
  const postback = await postbackRoute.POST(
    new Request("http://localhost/api/postback/shopee", {
      method: "POST",
      headers: workerAuthHeaders(),
      body: JSON.stringify({
        sub_id: subId,
        order_id: DEMO_ORDER_ID,
        order_amount: 199_000,
        estimated_commission: 19_900,
        status: "pending"
      })
    })
  );
  const postbackBody = (await postback.json()) as { ok: boolean; attributed?: boolean; error?: string };
  assert(postbackBody.ok, `postback failed: ${postbackBody.error}`);
  assert(postbackBody.attributed === true, "the postback was stored but not attributed to the task");
  ok("conversion stored and attributed");

  step("6/7 reconcile a late order (sub_id existed, link did not)");
  const { error: lateError } = await db.from("affiliate_conversions").insert({
    sub_id: subId,
    external_order_id: DEMO_LATE_ORDER_ID,
    order_amount: 50_000,
    estimated_commission: 5_000,
    status: "pending",
    converted_at: new Date().toISOString()
  });
  assert(!lateError, `could not stage the late order: ${lateError?.message}`);

  const reconcile = await reconcileRoute.POST(
    new Request("http://localhost/api/cron/reconcile", { method: "POST", headers: cronAuthHeaders() })
  );
  const reconcileBody = (await reconcile.json()) as { ok: boolean; attributed: number; error?: string };
  assert(reconcileBody.ok, `reconcile failed: ${reconcileBody.error}`);
  assert(reconcileBody.attributed >= 1, "reconcile did not attach the late order");

  const { data: lateOrder } = await db
    .from("affiliate_conversions")
    .select("task_id")
    .eq("external_order_id", DEMO_LATE_ORDER_ID)
    .maybeSingle();
  assert(lateOrder?.task_id === taskId, "the late order was not attached to the demo task");
  ok(`late order attached (${reconcileBody.attributed} conversion(s) reconciled)`);

  step("7/7 report query — the chain");
  const { data: task } = await db
    .from("comment_tasks")
    .select("id,status,post_url,sub_id_code,matched_product_id,assigned_account_id")
    .eq("id", taskId)
    .maybeSingle();

  const { data: conversions } = await db
    .from("affiliate_conversions")
    .select("external_order_id,order_amount,estimated_commission,status,task_id")
    .eq("task_id", taskId)
    .order("external_order_id");

  const revenue = (conversions ?? []).reduce((sum, row) => sum + Number(row.order_amount ?? 0), 0);
  const commission = (conversions ?? []).reduce(
    (sum, row) => sum + Number(row.estimated_commission ?? 0),
    0
  );

  console.log(
    [
      "",
      `  source      ${sourceId}`,
      `  post        ${task?.post_url}`,
      `  task        ${taskId} (${task?.status})`,
      `  sub_id      ${task?.sub_id_code}`,
      `  account     ${task?.assigned_account_id}`,
      `  product     ${task?.matched_product_id}`,
      ...(conversions ?? []).map(
        (row) =>
          `  conversion  ${row.external_order_id} · ${row.status} · ${row.order_amount} (commission ${row.estimated_commission})`
      ),
      `  totals      ${revenue} revenue · ${commission} commission`
    ].join("\n")
  );

  console.log("\nDEMO OK");
  return 0;
  } finally {
    // Direct update (not bump_trust_score): this is cleanup, not an earned increment.
    await db
      .from("social_accounts")
      .update({ trust_score: trustBefore, last_action_at: lastActionBefore })
      .eq("id", accountId);
    process.stdout.write(`  (restored account state: trust ${trustBefore}, last_action_at ${lastActionBefore ?? "null"})\n`);
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(`\nDEMO FAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });

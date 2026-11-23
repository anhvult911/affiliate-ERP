import assert from "node:assert/strict";
import test from "node:test";

import type { Tables } from "@/lib/database.types";
import { LEAD_OWNER_ID } from "@/lib/leads/config";
import type { LeadClassification, LeadClassifier } from "@/lib/leads/classifier";
import type { LeadAlertInput, Notifier } from "@/lib/leads/notifier";
import {
  MIN_POST_CHARS,
  matchesLeadKeywords,
  normalizeLeadText,
  processLeadPost,
  type LeadPipelineDeps
} from "@/lib/leads/pipeline";
import {
  LEAD_STATUS_CHANGED,
  LeadStoreError,
  type LeadStore
} from "@/lib/leads/store";

type LeadRow = Tables<"leads">;

const NOW = new Date("2026-11-23T09:00:00.000Z");

function classification(overrides: Partial<LeadClassification> = {}): LeadClassification {
  return {
    intent_type: "buyer_inquiry",
    score: 5,
    matched_category: "sheets_excel",
    summary: "Chủ shop cần file excel tính lãi lỗ theo từng sàn.",
    suggested_comment: "Mình từng làm file này cho shop. Inbox mình gửi mẫu nhé.",
    suggested_dm: "Chào bạn, shop đang bán trên sàn nào vậy?",
    ...overrides
  };
}

function createMemoryStore() {
  const rows: LeadRow[] = [];

  const store: LeadStore = {
    async insertPending(input) {
      if (rows.some((row) => row.user_id === input.ownerId && row.post_id === input.postId)) {
        return { inserted: false, leadId: null };
      }

      const at = NOW.toISOString();
      const row: LeadRow = {
        id: `lead-${rows.length + 1}`,
        user_id: input.ownerId,
        post_id: input.postId,
        group_id: input.groupId,
        group_name: input.groupName,
        post_url: input.postUrl,
        author_name: input.authorName,
        post_content: input.content,
        intent_type: null,
        score: null,
        matched_category: null,
        summary: null,
        suggested_comment: null,
        suggested_dm: null,
        status: "pending_review",
        notes: null,
        alert_sent_at: null,
        last_contacted_at: null,
        next_followup_at: null,
        created_at: at,
        updated_at: at
      };

      rows.push(row);
      return { inserted: true, leadId: row.id };
    },

    async saveClassification(input) {
      const row = rows.find(
        (candidate) => candidate.id === input.leadId && candidate.user_id === input.ownerId
      );

      if (!row || row.status !== "pending_review") {
        throw new LeadStoreError("The lead is no longer pending review.", {
          code: LEAD_STATUS_CHANGED
        });
      }

      Object.assign(row, input.classification, {
        status: "new",
        updated_at: NOW.toISOString()
      });
    },

    async markAlertSent(input) {
      const row = rows.find(
        (candidate) => candidate.id === input.leadId && candidate.user_id === input.ownerId
      );
      if (!row) throw new LeadStoreError("The alerted lead no longer exists.");
      row.alert_sent_at = input.sentAt;
      row.updated_at = NOW.toISOString();
    }
  };

  return { store, rows };
}

function createClassifier(result: LeadClassification | Error) {
  const calls: { content: string; groupName: string; keywords?: readonly string[] }[] = [];
  const classifier: LeadClassifier = async (input) => {
    calls.push(input);
    if (result instanceof Error) throw result;
    return result;
  };
  return { classifier, calls };
}

type ClassifierHarness = {
  classifier: LeadClassifier;
  calls: { content: string; groupName: string; keywords?: readonly string[] }[];
};

function createNotifier(options: { fail?: boolean } = {}) {
  const alerts: LeadAlertInput[] = [];
  let attempts = 0;
  const notifier: Notifier = {
    async sendAlert(input) {
      attempts += 1;
      if (options.fail) throw new Error("telegram failed with 123456:ABCDEFGHIJKLMNOPQRSTUVWX");
      alerts.push(input);
    }
  };
  return { notifier, alerts, attempts: () => attempts };
}

type NotifierHarness = {
  notifier: Notifier;
  alerts: LeadAlertInput[];
  attempts: () => number;
};

const SOURCE = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "Chủ shop online",
  keywords: ["file excel", "lãi lỗ"]
};

const POST = {
  postId: "post-1",
  postUrl: "https://facebook.com/groups/123/posts/1?ref=private-token",
  content: "Shop mình cần file excel tính lãi lỗ theo từng sàn, ai giúp với ạ",
  authorName: "Chị Lan"
};

function baseDeps(overrides: Partial<LeadPipelineDeps> = {}): {
  deps: LeadPipelineDeps;
  rows: LeadRow[];
  classifier: ClassifierHarness;
  notifier: NotifierHarness;
} {
  const memory = createMemoryStore();
  const classifier = createClassifier(classification());
  const notifier = createNotifier();

  return {
    deps: {
      store: memory.store,
      classifier: classifier.classifier,
      notifier: notifier.notifier,
      now: () => new Date(NOW),
      env: {},
      ...overrides
    },
    rows: memory.rows,
    classifier,
    notifier
  };
}

test("normalisation makes keyword matching accent- and case-insensitive", () => {
  assert.equal(normalizeLeadText("TÍNH LÃI LỖ, phí sàn!"), "tinh lai lo phi san");
  assert.equal(matchesLeadKeywords("Shop cần Tinh Lai Lo", ["tính lãi lỗ"]), true);
  assert.equal(matchesLeadKeywords("Shop cần báo cáo", ["tính lãi lỗ"]), false);
  assert.equal(matchesLeadKeywords("anything", []), false);
});

test("empty and short posts are skipped before the store or the LLM is touched", async () => {
  const { deps, rows, classifier } = baseDeps();

  const empty = await processLeadPost(
    { owner: LEAD_OWNER_ID, source: SOURCE, post: { ...POST, content: "   " } },
    deps
  );
  const short = await processLeadPost(
    { owner: LEAD_OWNER_ID, source: SOURCE, post: { ...POST, content: "file excel" } },
    deps
  );

  assert.equal(empty.outcome, "skipped");
  assert.equal(empty.outcome === "skipped" ? empty.reason : null, "empty");
  assert.equal(short.outcome, "skipped");
  assert.equal(short.outcome === "skipped" ? short.reason : null, "too_short");
  assert.ok("file excel".length < MIN_POST_CHARS);
  assert.equal(rows.length, 0);
  assert.equal(classifier.calls.length, 0);
});

test("a non-matching post is skipped", async () => {
  const { deps, rows, classifier } = baseDeps();

  const result = await processLeadPost(
    { owner: LEAD_OWNER_ID, source: SOURCE, post: { ...POST, content: "Hôm nay trời đẹp quá mọi người ơi" } },
    deps
  );

  assert.equal(result.outcome, "skipped");
  assert.equal(result.outcome === "skipped" ? result.reason : null, "no_keyword");
  assert.equal(rows.length, 0);
  assert.equal(classifier.calls.length, 0);
});

test("an explicit empty keyword list disables capture; a missing one uses the preset", async () => {
  const disabled = baseDeps();
  const disabledResult = await processLeadPost(
    { owner: LEAD_OWNER_ID, source: { ...SOURCE, keywords: [] }, post: POST },
    disabled.deps
  );

  assert.equal(disabledResult.outcome, "skipped");
  assert.equal(disabledResult.outcome === "skipped" ? disabledResult.reason : null, "no_keyword");
  assert.equal(disabled.rows.length, 0);
  assert.equal(disabled.classifier.calls.length, 0);

  const preset = baseDeps();
  const presetResult = await processLeadPost(
    {
      owner: LEAD_OWNER_ID,
      source: { name: "Nhóm mặc định", id: null, keywords: null },
      post: { ...POST, content: "Cần người làm google sheet quản lý kho giúp mình với" }
    },
    preset.deps
  );

  assert.equal(presetResult.outcome, "classified");
});

test("feeding the same post twice classifies and alerts only once", async () => {
  const { deps, rows, classifier, notifier } = baseDeps();

  const first = await processLeadPost({ owner: LEAD_OWNER_ID, source: SOURCE, post: POST }, deps);
  const second = await processLeadPost({ owner: LEAD_OWNER_ID, source: SOURCE, post: POST }, deps);

  assert.equal(first.outcome, "classified");
  assert.equal(second.outcome, "skipped");
  assert.equal(second.outcome === "skipped" ? second.reason : null, "duplicate");
  assert.equal(rows.length, 1);
  assert.equal(classifier.calls.length, 1);
  assert.equal(notifier.alerts.length, 1);
});

test("concurrent discovery of the same post claims it exactly once", async () => {
  const { deps, rows, classifier, notifier } = baseDeps();

  const results = await Promise.all([
    processLeadPost({ owner: LEAD_OWNER_ID, source: SOURCE, post: POST }, deps),
    processLeadPost({ owner: LEAD_OWNER_ID, source: SOURCE, post: POST }, deps)
  ]);

  assert.deepEqual(results.map((result) => result.outcome).sort(), ["classified", "skipped"]);
  assert.equal(rows.length, 1);
  assert.equal(classifier.calls.length, 1);
  assert.equal(notifier.alerts.length, 1);
});

test("a qualifying buyer post is persisted and alerted with the exact notifier contract", async () => {
  const { deps, rows, notifier } = baseDeps();

  const result = await processLeadPost({ owner: LEAD_OWNER_ID, source: SOURCE, post: POST }, deps);

  assert.equal(result.outcome, "classified");
  assert.equal(result.outcome === "classified" ? result.alertSent : null, true);

  const row = rows[0];
  assert.ok(row);
  assert.equal(row.status, "new");
  assert.equal(row.intent_type, "buyer_inquiry");
  assert.equal(row.score, 5);
  assert.equal(row.matched_category, "sheets_excel");
  assert.equal(row.summary, classification().summary);
  assert.equal(row.alert_sent_at, NOW.toISOString());
  assert.equal(row.post_content, POST.content);

  assert.deepEqual(notifier.alerts[0], {
    score: 5,
    matched_category: "sheets_excel",
    group_name: SOURCE.name,
    post_url: POST.postUrl,
    summary: classification().summary,
    suggested_comment: classification().suggested_comment,
    suggested_dm: classification().suggested_dm
  });
});

test("low-score and seller-promo posts are still persisted but never alert", async () => {
  const lowScore = baseDeps({ classifier: createClassifier(classification({ score: 3, intent_type: "help_needed" })).classifier });
  await processLeadPost({ owner: LEAD_OWNER_ID, source: SOURCE, post: POST }, lowScore.deps);

  assert.equal(lowScore.rows[0]?.status, "new");
  assert.equal(lowScore.rows[0]?.score, 3);
  assert.equal(lowScore.rows[0]?.alert_sent_at, null);
  assert.equal(lowScore.notifier.alerts.length, 0);

  const seller = baseDeps({
    classifier: createClassifier(
      classification({ score: 2, intent_type: "seller_promo", matched_category: "other" })
    ).classifier
  });
  await processLeadPost({ owner: LEAD_OWNER_ID, source: SOURCE, post: POST }, seller.deps);

  assert.equal(seller.rows[0]?.status, "new");
  assert.equal(seller.rows[0]?.alert_sent_at, null);
  assert.equal(seller.notifier.alerts.length, 0);

  const loudSeller = baseDeps({
    classifier: createClassifier(classification({ score: 5, intent_type: "seller_promo" })).classifier
  });
  await processLeadPost({ owner: LEAD_OWNER_ID, source: SOURCE, post: POST }, loudSeller.deps);

  assert.equal(loudSeller.rows[0]?.status, "new");
  assert.equal(loudSeller.rows[0]?.alert_sent_at, null);
  assert.equal(loudSeller.notifier.alerts.length, 0);
});

test("MIN_INTENT_SCORE from the environment is applied", async () => {
  const { deps, notifier } = baseDeps({
    classifier: createClassifier(classification({ score: 3, intent_type: "help_needed" })).classifier,
    env: { MIN_INTENT_SCORE: "3" }
  });

  const result = await processLeadPost({ owner: LEAD_OWNER_ID, source: SOURCE, post: POST }, deps);

  assert.equal(result.outcome, "classified");
  assert.equal(result.outcome === "classified" ? result.alertSent : null, true);
  assert.equal(notifier.alerts.length, 1);
});

test("an explicit minIntentScore dep overrides the environment", async () => {
  const { deps, notifier } = baseDeps({
    classifier: createClassifier(classification({ score: 3, intent_type: "help_needed" })).classifier,
    env: { MIN_INTENT_SCORE: "2" },
    minIntentScore: 4
  });

  await processLeadPost({ owner: LEAD_OWNER_ID, source: SOURCE, post: POST }, deps);

  assert.equal(notifier.alerts.length, 0);
});

test("an LLM failure leaves the raw post as pending_review and does not crash", async () => {
  const { deps, rows, notifier } = baseDeps({
    classifier: createClassifier(new Error("provider unavailable")).classifier
  });

  const result = await processLeadPost({ owner: LEAD_OWNER_ID, source: SOURCE, post: POST }, deps);

  assert.equal(result.outcome, "pending_review");
  assert.equal(result.outcome === "pending_review" ? result.reason : null, "llm_failed");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.status, "pending_review");
  assert.equal(rows[0]?.post_content, POST.content);
  assert.equal(rows[0]?.intent_type, null);
  assert.equal(rows[0]?.score, null);
  assert.equal(rows[0]?.alert_sent_at, null);
  assert.equal(notifier.alerts.length, 0);
});

test("a concurrent operator disposition wins and suppresses the alert", async () => {
  const memory = createMemoryStore();

  const classifier: LeadClassifier = async (input) => {
    // The operator opens the pending row and ignores it while the LLM is running.
    const pending = memory.rows.find((row) => row.status === "pending_review");
    assert.ok(pending);
    pending.status = "ignored";
    assert.ok(input.content.length > 0);
    return classification();
  };

  const notifier = createNotifier();
  const deps: LeadPipelineDeps = {
    store: memory.store,
    classifier,
    notifier: notifier.notifier,
    now: () => new Date(NOW),
    env: {}
  };

  const result = await processLeadPost({ owner: LEAD_OWNER_ID, source: SOURCE, post: POST }, deps);

  assert.equal(result.outcome, "skipped");
  assert.equal(result.outcome === "skipped" ? result.reason : null, "status_changed");
  assert.equal(memory.rows[0]?.status, "ignored");
  assert.equal(memory.rows[0]?.intent_type, null);
  assert.equal(memory.rows[0]?.alert_sent_at, null);
  assert.equal(notifier.alerts.length, 0);
});

test("a notifier failure keeps the classification and leaves alert_sent_at empty", async () => {
  const { deps, rows } = baseDeps({ notifier: createNotifier({ fail: true }).notifier });

  const result = await processLeadPost({ owner: LEAD_OWNER_ID, source: SOURCE, post: POST }, deps);
  assert.equal(result.outcome, "classified");
  assert.equal(result.outcome === "classified" ? result.alertSent : null, false);

  assert.equal(rows[0]?.status, "new");
  assert.equal(rows[0]?.score, 5);
  assert.equal(rows[0]?.alert_sent_at, null);
});

test("a store failure before the LLM returns failed and never classifies", async () => {
  const memory = createMemoryStore();
  const failingStore: LeadStore = {
    ...memory.store,
    async insertPending() {
      throw new LeadStoreError("database down");
    }
  };
  const classifier = createClassifier(classification());

  const result = await processLeadPost(
    { owner: LEAD_OWNER_ID, source: SOURCE, post: POST },
    { store: failingStore, classifier: classifier.classifier, notifier: createNotifier().notifier, env: {} }
  );

  assert.equal(result.outcome, "failed");
  assert.equal(result.outcome === "failed" ? result.reason : null, "store");
  assert.equal(classifier.calls.length, 0);
  assert.equal(memory.rows.length, 0);
});

test("a classification save failure keeps pending_review and never alerts", async () => {
  const memory = createMemoryStore();
  const failingStore: LeadStore = {
    ...memory.store,
    async saveClassification() {
      throw new LeadStoreError("database down");
    }
  };
  const classifier = createClassifier(classification());
  const notifier = createNotifier();

  const result = await processLeadPost(
    {
      owner: LEAD_OWNER_ID,
      source: SOURCE,
      post: POST
    },
    { store: failingStore, classifier: classifier.classifier, notifier: notifier.notifier, env: {} }
  );

  assert.equal(result.outcome, "pending_review");
  assert.equal(result.outcome === "pending_review" ? result.reason : null, "store_failed");
  assert.equal(memory.rows[0]?.status, "pending_review");
  assert.equal(notifier.alerts.length, 0);
});

test("the owner defaults to LEAD_OWNER_ID and is written onto the lead", async () => {
  const fallback = baseDeps();
  await processLeadPost({ owner: "   ", source: SOURCE, post: POST }, fallback.deps);
  assert.equal(fallback.rows[0]?.user_id, LEAD_OWNER_ID);

  const scoped = baseDeps();
  await processLeadPost({ owner: "tenant-2", source: SOURCE, post: POST }, scoped.deps);
  assert.equal(scoped.rows[0]?.user_id, "tenant-2");
});

test("only the trimmed, length-capped content reaches the LLM; the raw post is persisted", async () => {
  const longContent = `${POST.content} ${"chi tiết ".repeat(900)}`;
  const { deps, rows, classifier } = baseDeps();

  await processLeadPost(
    { owner: LEAD_OWNER_ID, source: SOURCE, post: { ...POST, content: `  ${longContent}  ` } },
    deps
  );

  assert.equal(rows[0]?.post_content, longContent.trim());
  const sent = classifier.calls[0]?.content ?? "";
  assert.ok(sent.length < longContent.length);
});

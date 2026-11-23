import assert from "node:assert/strict";
import test from "node:test";

import type { SupabaseDb } from "@/lib/db";
import type { LeadClassification } from "@/lib/leads/classifier";
import {
  LEAD_STATUS_CHANGED,
  LeadStoreError,
  createSupabaseLeadStore
} from "@/lib/leads/store";

type QueryError = { code?: string; message: string };
type QueryResponse = { data: unknown; error: QueryError | null };

type RecordedCall = {
  op: "insert" | "update";
  values: Record<string, unknown>;
  filters: Record<string, unknown>;
};

function fakeDb(responses: { insert?: QueryResponse; update?: QueryResponse } = {}) {
  const calls: RecordedCall[] = [];

  const db = {
    from(table: string) {
      assert.equal(table, "leads");

      return {
        insert(values: Record<string, unknown>) {
          calls.push({ op: "insert", values, filters: {} });
          return {
            select() {
              return {
                single: async () =>
                  responses.insert ?? { data: { id: "lead-1" }, error: null }
              };
            }
          };
        },

        update(values: Record<string, unknown>) {
          const call: RecordedCall = { op: "update", values, filters: {} };
          calls.push(call);

          const builder = {
            eq(column: string, value: unknown) {
              call.filters[column] = value;
              return builder;
            },
            select() {
              return {
                maybeSingle: async () =>
                  responses.update ?? { data: { id: "lead-1" }, error: null }
              };
            }
          };

          return builder;
        }
      };
    }
  };

  return { db: db as unknown as SupabaseDb, calls };
}

const INPUT = {
  ownerId: "default_owner",
  postId: "post-42",
  groupId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  groupName: "Chủ shop online",
  postUrl: "https://facebook.com/groups/1/posts/42",
  authorName: "Chị Lan",
  content: "Cần file excel tính lãi lỗ theo từng sàn"
};

function classification(): LeadClassification {
  return {
    intent_type: "buyer_inquiry",
    score: 5,
    matched_category: "sheets_excel",
    summary: "Cần file quản lý lãi lỗ.",
    suggested_comment: "Mình có mẫu phù hợp, inbox mình nhé.",
    suggested_dm: "Shop đang bán trên sàn nào vậy?"
  };
}

test("insertPending claims the raw post as pending_review", async () => {
  const { db, calls } = fakeDb();
  const store = createSupabaseLeadStore(db);

  const result = await store.insertPending(INPUT);

  assert.deepEqual(result, { inserted: true, leadId: "lead-1" });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.values, {
    user_id: "default_owner",
    post_id: "post-42",
    group_id: INPUT.groupId,
    group_name: "Chủ shop online",
    post_url: INPUT.postUrl,
    author_name: "Chị Lan",
    post_content: INPUT.content,
    status: "pending_review"
  });
});

test("a duplicate (user_id, post_id) is a soft skip, not an error", async () => {
  const { db } = fakeDb({
    insert: { data: null, error: { code: "23505", message: "duplicate key value" } }
  });

  const result = await createSupabaseLeadStore(db).insertPending(INPUT);

  assert.deepEqual(result, { inserted: false, leadId: null });
});

test("other insert errors surface as LeadStoreError", async () => {
  const { db } = fakeDb({
    insert: { data: null, error: { code: "23503", message: "foreign key violation" } }
  });

  await assert.rejects(
    () => createSupabaseLeadStore(db).insertPending(INPUT),
    (error: unknown) => error instanceof LeadStoreError && error.code === "23503"
  );
});

test("a claim without an id is treated as a store failure", async () => {
  const { db } = fakeDb({ insert: { data: null, error: null } });

  await assert.rejects(
    () => createSupabaseLeadStore(db).insertPending(INPUT),
    (error: unknown) => error instanceof LeadStoreError
  );
});

test("saveClassification writes the contract fields, status new, owner and pending gate", async () => {
  const { db, calls } = fakeDb();
  await createSupabaseLeadStore(db).saveClassification({
    ownerId: "default_owner",
    leadId: "lead-1",
    classification: classification()
  });

  const call = calls[0];
  assert.ok(call);
  assert.equal(call.op, "update");
  assert.deepEqual(call.values, {
    intent_type: "buyer_inquiry",
    score: 5,
    matched_category: "sheets_excel",
    summary: "Cần file quản lý lãi lỗ.",
    suggested_comment: "Mình có mẫu phù hợp, inbox mình nhé.",
    suggested_dm: "Shop đang bán trên sàn nào vậy?",
    status: "new"
  });
  assert.deepEqual(call.filters, {
    id: "lead-1",
    user_id: "default_owner",
    status: "pending_review"
  });
});

test("a classification is discarded when the operator already changed the status", async () => {
  const { db } = fakeDb({ update: { data: null, error: null } });

  await assert.rejects(
    () =>
      createSupabaseLeadStore(db).saveClassification({
        ownerId: "default_owner",
        leadId: "lead-1",
        classification: classification()
      }),
    (error: unknown) => error instanceof LeadStoreError && error.code === LEAD_STATUS_CHANGED
  );
});

test("saveClassification database errors surface as LeadStoreError", async () => {
  const { db } = fakeDb({
    update: { data: null, error: { code: "42501", message: "permission denied" } }
  });

  await assert.rejects(
    () =>
      createSupabaseLeadStore(db).saveClassification({
        ownerId: "default_owner",
        leadId: "lead-1",
        classification: classification()
      }),
    (error: unknown) => error instanceof LeadStoreError && error.code === "42501"
  );
});

test("markAlertSent timestamps the lead only for its owner", async () => {
  const { db, calls } = fakeDb();
  await createSupabaseLeadStore(db).markAlertSent({
    ownerId: "default_owner",
    leadId: "lead-1",
    sentAt: "2026-11-23T09:00:00.000Z"
  });

  const call = calls[0];
  assert.ok(call);
  assert.deepEqual(call.values, { alert_sent_at: "2026-11-23T09:00:00.000Z" });
  assert.deepEqual(call.filters, { id: "lead-1", user_id: "default_owner" });
});

test("markAlertSent failures surface as LeadStoreError", async () => {
  const { db } = fakeDb({
    update: { data: null, error: { code: "42501", message: "permission denied" } }
  });

  await assert.rejects(
    () =>
      createSupabaseLeadStore(db).markAlertSent({
        ownerId: "default_owner",
        leadId: "lead-1",
        sentAt: "2026-11-23T09:00:00.000Z"
      }),
    (error: unknown) => error instanceof LeadStoreError && error.code === "42501"
  );
});

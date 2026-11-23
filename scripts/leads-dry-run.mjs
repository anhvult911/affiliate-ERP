import assert from "node:assert/strict";
import { createFixtureDb } from "../supabase/ci/fixture-db.mjs";
import { LEAD_OWNER_ID } from "../src/lib/leads/config.ts";
import { createLlmClassifier } from "../src/lib/leads/classifier.ts";
import { buildLeadAlert } from "../src/lib/leads/notifier.ts";
import { processLeadPost } from "../src/lib/leads/pipeline.ts";
import { leadExamples } from "./lib/lead-examples.mjs";
import { dryRunRepository } from "./lib/lead-dry-store.mjs";

const { db } = await createFixtureDb();
try {
  const { rows: [group] } = await db.query(`insert into public.target_sources (user_id, name, url, source_type)
    values ($1, 'Chủ shop thử nghiệm', 'https://www.facebook.com/groups/demo', 'group') returning id, name, url, keywords_json`, [LEAD_OWNER_ID]);
  let modelCalls = 0;
  const alerts = [];
  const classifier = createLlmClassifier({
    env: { LLM_API_KEY: 'offline-fixture', LLM_MODEL: 'offline-test' },
    fetch: async (_url, init) => {
      const messages = JSON.parse(init.body).messages;
      const example = leadExamples.find(({ text }) => messages.some((m) => m.role === 'user' && m.content.includes(text)));
      assert.ok(example, 'Model received an unexpected post');
      modelCalls++;
      return Response.json({ choices: [{ message: { content: JSON.stringify(example.classification) } }] });
    }
  });
  const deps = {
    classifier, store: dryRunRepository(db), minIntentScore: 4,
    notifier: { async sendAlert(input) { alerts.push(input); } }
  };
  for (const [i, example] of leadExamples.entries()) {
    const postUrl = `${group.url}/posts/${i + 1}`;
    const input = { owner: LEAD_OWNER_ID, source: { id: group.id, name: group.name, keywords: group.keywords_json },
      post: { postId: postUrl, postUrl, content: example.text } };
    const result = await processLeadPost(input, deps);
    assert.equal(result.outcome, 'classified');
    if (i === 0) {
      const replay = await processLeadPost(input, deps);
      assert.equal(replay.reason, 'duplicate');
    }
  }
  const { rows } = await db.query(`select intent_type, score, status, alert_sent_at is not null as alerted
    from public.leads where user_id=$1 order by post_id`, [LEAD_OWNER_ID]);
  assert.equal(modelCalls, 3);
  assert.equal(alerts.length, 2);
  assert.deepEqual(rows.map(r => [r.intent_type, r.score, r.status, r.alerted]), [
    ['buyer_inquiry', 5, 'new', true], ['help_needed', 4, 'new', true], ['seller_promo', 2, 'new', false]
  ]);
  for (const alert of alerts) console.log(`\nOffline Telegram preview (not sent):\n${buildLeadAlert(alert)}`);
  console.table(rows);
  console.log('3 classified; 2 alerts; 1 duplicate skipped. Database discarded.');
} finally {
  await db.close();
}

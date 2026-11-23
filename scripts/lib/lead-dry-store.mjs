/** SQL persistence for the offline demo. Same schema, uniqueness and transition triggers as Supabase. */
export function dryRunRepository(db) {
  return {
    async insertPending({ ownerId, postId, groupId, groupName, postUrl, content, authorName }) {
      const result = await db.query(`
        insert into public.leads (user_id, post_id, group_id, group_name, post_url, post_content, author_name, status)
        values ($1, $2, $3, $4, $5, $6, $7, 'pending_review')
        on conflict (user_id, post_id) do nothing returning id
      `, [ownerId, postId, groupId, groupName, postUrl, content, authorName]);
      return { inserted: result.rows.length === 1, leadId: result.rows[0]?.id ?? null };
    },
    async saveClassification({ ownerId, leadId, classification: value }) {
      const result = await db.query(`update public.leads set status='new', intent_type=$3, score=$4,
        matched_category=$5, summary=$6, suggested_comment=$7, suggested_dm=$8
        where user_id=$1 and id=$2 and status='pending_review' returning id`,
      [ownerId, leadId, value.intent_type, value.score, value.matched_category, value.summary, value.suggested_comment, value.suggested_dm]);
      if (!result.rows.length) throw new Error('Demo lead not found.');
    },
    async markAlertSent({ ownerId, leadId, sentAt }) {
      await db.query('update public.leads set alert_sent_at=$3 where user_id=$1 and id=$2', [ownerId, leadId, sentAt]);
    }
  };
}

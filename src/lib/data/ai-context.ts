/**
 * Read-only queries for the /ai control room. Kept separate from the mutation
 * modules so the page can compose exactly the context the engine receives.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ExecutionMode, SourceType } from "@/lib/constants";
import type { Json } from "@/lib/database.types";

export type SourceContextRow = {
  id: string;
  name: string;
  source_type: SourceType;
  niche: string | null;
  tone_of_voice: string | null;
  group_rules: string | null;
  is_active: boolean;
};

export type AiPromptExample = {
  taskId: string;
  postUrl: string;
  postContent: string;
  postImages: string[];
  executionMode: ExecutionMode;
  matchScore: number | null;
  product: {
    id: string;
    name: string;
    niche: string | null;
    pros_cons_summary: string | null;
  };
  source: {
    id: string;
    name: string;
    niche: string | null;
    tone_of_voice: string | null;
    group_rules: string | null;
  };
  account: {
    id: string;
    name: string;
    persona_type: string;
  } | null;
};

export type MatchCandidateRow = {
  id: string;
  name: string;
  niche: string | null;
  pros_cons_summary: string | null;
};

export type PendingDraftTask = {
  id: string;
  postUrl: string;
  postExcerpt: string;
  productName: string | null;
  sourceName: string | null;
  executionMode: ExecutionMode;
};

function toStringArray(value: Json): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

/** Every watched source, with the tone/rules presence the prompt injects. */
export async function getSourceContexts(): Promise<SourceContextRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("target_sources")
    .select("id, name, source_type, niche, tone_of_voice, group_rules, is_active")
    .order("name", { ascending: true });

  if (error) throw new Error(`Could not load target sources: ${error.message}`);
  return data ?? [];
}

/** Active products offered to the matcher as candidates. */
export async function getMatchCandidates(): Promise<MatchCandidateRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("products")
    .select("id, name, niche, pros_cons_summary")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(8);

  if (error) throw new Error(`Could not load products for the match prompt: ${error.message}`);
  return data ?? [];
}

/**
 * Newest pending task that already has a matched product and a source. Used as
 * the real prompt example; null means the page falls back to a synthetic one.
 */
export async function getPromptExample(): Promise<AiPromptExample | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("comment_tasks")
    .select(
      `id, post_url, post_content, post_images, execution_mode, match_score,
       product:products(id, name, niche, pros_cons_summary),
       source:target_sources(id, name, niche, tone_of_voice, group_rules),
       account:social_accounts!comment_tasks_assigned_account_id_fkey(id, name, persona_type)`
    )
    .eq("status", "pending_approval")
    .not("matched_product_id", "is", null)
    .not("source_id", "is", null)
    .neq("post_content", "")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Could not load the prompt example: ${error.message}`);
  if (!data) return null;

  const product = data.product;
  const source = data.source;
  if (!product || !source) return null;

  return {
    taskId: data.id,
    postUrl: data.post_url,
    postContent: data.post_content ?? "",
    postImages: toStringArray(data.post_images),
    executionMode: data.execution_mode,
    matchScore: data.match_score,
    product,
    source,
    account: data.account
  };
}

/** Draftable pending tasks for the playground select. */
export async function getPendingDraftTasks(): Promise<PendingDraftTask[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("comment_tasks")
    .select(
      `id, post_url, post_content, execution_mode,
       product:products(name), source:target_sources(name)`
    )
    .eq("status", "pending_approval")
    .not("matched_product_id", "is", null)
    .not("source_id", "is", null)
    .neq("post_content", "")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw new Error(`Could not load pending tasks: ${error.message}`);

  return (data ?? []).map((task) => {
    const content = (task.post_content ?? "").replace(/\s+/g, " ").trim();
    const postExcerpt =
      content.length > 90 ? `${content.slice(0, 90)}…` : content || "No post text";

    return {
      id: task.id,
      postUrl: task.post_url,
      postExcerpt,
      productName: task.product?.name ?? null,
      sourceName: task.source?.name ?? null,
      executionMode: task.execution_mode
    };
  });
}

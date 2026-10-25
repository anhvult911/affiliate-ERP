/**
 * Operator-session draft endpoint.
 *
 * Runs with the signed-in operator's Supabase session (RLS applies), never the
 * worker bearer token. The Gemini key stays inside `src/lib/ai/gemini.ts` and is
 * never included in a response.
 */

import { NextResponse } from "next/server";

import { draftComment, isGeminiConfigured, GEMINI_NOT_CONFIGURED_MESSAGE } from "@/lib/ai/gemini";
import type { Json } from "@/lib/database.types";
import { errorMessage } from "@/lib/result";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { aiDraftRequestSchema } from "@/lib/validations/ai";

export const runtime = "nodejs";

function toStringArray(value: Json): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

/** Gemini SDK errors can echo request details; never let the key reach the client. */
function redactSecret(message: string): string {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return message;
  return message.replaceAll(key, "[redacted]");
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = aiDraftRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request body." },
      { status: 400 }
    );
  }

  if (!isGeminiConfigured()) {
    return NextResponse.json({ ok: false, error: GEMINI_NOT_CONFIGURED_MESSAGE }, { status: 400 });
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data: task, error } = await supabase
      .from("comment_tasks")
      .select(
        `id, post_url, post_content, post_images, execution_mode, status,
         product:products(id, name, niche, pros_cons_summary, review_images, affiliate_short_link),
         source:target_sources(id, name, tone_of_voice, group_rules, niche),
         account:social_accounts!comment_tasks_assigned_account_id_fkey(id, name, persona_type)`
      )
      .eq("id", parsed.data.taskId)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { ok: false, error: `Could not load the task: ${error.message}` },
        { status: 500 }
      );
    }

    if (!task) {
      return NextResponse.json({ ok: false, error: "Task not found." }, { status: 404 });
    }

    if (task.status !== "pending_approval") {
      return NextResponse.json(
        { ok: false, error: "Only tasks awaiting approval can be drafted." },
        { status: 409 }
      );
    }

    if (!task.product || !task.source) {
      return NextResponse.json(
        {
          ok: false,
          error: "This task needs a matched product and a target source before Gemini can draft."
        },
        { status: 400 }
      );
    }

    const postContent = task.post_content?.trim();
    if (!postContent) {
      return NextResponse.json(
        { ok: false, error: "This task has no post text to draft from." },
        { status: 400 }
      );
    }

    const draft = await draftComment({
      post: {
        content: postContent,
        images: toStringArray(task.post_images),
        url: task.post_url
      },
      product: task.product,
      source: task.source,
      persona: task.account ?? {
        name: "Community member",
        persona_type: "ordinary shopper"
      },
      mode: task.execution_mode,
      guidance: parsed.data.guidance ?? null
    });

    // Persist only the comment body. review_note is operator feedback, not a
    // place to stash the seeding follow-up; the caller receives that instead.
    const { data: updated, error: updateError } = await supabase
      .from("comment_tasks")
      .update({ ai_draft_comment: draft.comment })
      .eq("id", task.id)
      .eq("status", "pending_approval")
      .select("id")
      .maybeSingle();

    if (updateError) {
      return NextResponse.json(
        { ok: false, error: `Draft generated but could not be saved: ${updateError.message}` },
        { status: 500 }
      );
    }

    if (!updated) {
      return NextResponse.json(
        {
          ok: false,
          error: "The task is no longer awaiting approval; the draft was not saved."
        },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { ok: true, draft: draft.comment, followUp: draft.followUp },
      { status: 200 }
    );
  } catch (error) {
    return NextResponse.json({ ok: false, error: redactSecret(errorMessage(error)) }, { status: 500 });
  }
}

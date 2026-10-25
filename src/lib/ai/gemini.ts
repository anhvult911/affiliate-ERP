/**
 * Server-only Gemini wrapper for the AI Contextual Engine.
 *
 * The API key is read lazily inside every call so the app builds and renders
 * with no GEMINI_API_KEY present. Never import this module from a client
 * component: it pulls in the SDK and the server environment.
 */

import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

import {
  DRAFT_RESPONSE_SCHEMA,
  MATCH_RESPONSE_SCHEMA,
  buildDraftPrompt,
  buildMatchPrompt,
  type DraftPromptInput,
  type MatchPromptInput
} from "@/lib/ai/prompts";

/**
 * Primary model, then the models tried when it is saturated.
 *
 * Order is by measured reliability, not by size: the radar runs unattended and a
 * saturated model costs a whole capture. Measured on this key — 3.8-flash 503,
 * 3.5-flash 503, 3.1-flash-lite answered in 1.7s. Set `GEMINI_MODEL` to move up a
 * tier once the account has headroom; the chain keeps the radar alive either way.
 *
 * `gemini-2.5-flash` still lists itself in /models but rejects requests for keys
 * created after its retirement ("no longer available to new users").
 */
export const DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-lite";
export const GEMINI_MODEL_FALLBACKS = ["gemini-3.8-flash", "gemini-flash-lite-latest"];

/** Models to try, in order, without duplicates. */
export function geminiModelChain(): string[] {
  const primary = readGeminiModel();
  return [primary, ...GEMINI_MODEL_FALLBACKS].filter(
    (model, index, all) => model.length > 0 && all.indexOf(model) === index
  );
}
// `text-embedding-004` is retired for new keys; 001 is the current model and still
// emits 768 dims when asked (products.embedding is vector(768)).
export const DEFAULT_EMBEDDING_MODEL = "gemini-embedding-001";
export const EMBEDDING_DIMENSIONS = 768;

export const GEMINI_NOT_CONFIGURED_MESSAGE =
  "Gemini is not configured. Set GEMINI_API_KEY in .env.local (or the deployment environment) and restart the app.";

export type MatchAnalysis = {
  productId: string | null;
  score: number;
  reason: string;
};

export type DraftResult = {
  comment: string;
  followUp: string | null;
};

/** Generation model for matching and drafting, resolved at call time. */
export function readGeminiModel(): string {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
}

/** Embedding model, resolved at call time. Must emit 768-dim vectors. */
export function readEmbeddingModel(): string {
  return process.env.GEMINI_EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL;
}

export function isGeminiConfigured(): boolean {
  return (process.env.GEMINI_API_KEY?.trim().length ?? 0) > 0;
}

function createClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error(GEMINI_NOT_CONFIGURED_MESSAGE);

  // A saturated model otherwise keeps the request open until the caller's own
  // timeout fires; 30s per attempt keeps the fallback chain useful.
  return new GoogleGenAI({ apiKey, httpOptions: { timeout: 15_000 } });
}

/** Saturation and quota errors — the only ones worth trying another model for. */
const TRANSIENT = /429|RESOURCE_EXHAUSTED|503|UNAVAILABLE|overloaded|high demand|deadline/i;

/**
 * Calls the model chain until one answers.
 *
 * A 15-second per-attempt timeout matters as much as the fallback: without it the
 * SDK keeps retrying a saturated model and the request outlives the caller's own
 * timeout, which is exactly how a capture turned into a 3-minute hang.
 */
async function generateWithFallback(request: {
  contents: string;
  config: Record<string, unknown>;
}): Promise<Awaited<ReturnType<GoogleGenAI["models"]["generateContent"]>>> {
  const client = createClient();
  const chain = geminiModelChain();
  let lastError: unknown = new Error("Gemini did not answer.");

  for (const model of chain) {
    try {
      return await client.models.generateContent({
        model,
        contents: request.contents,
        config: request.config,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK types the config as a union
      } as any);
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!TRANSIENT.test(message)) throw error;
    }
  }

  throw lastError;
}

/** Removes an accidental markdown fence before JSON.parse. */
function parseJsonObject(text: string, context: string): unknown {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  if (!trimmed) throw new Error(`Gemini returned an empty ${context} response.`);

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    throw new Error(
      `Gemini returned a ${context} response that was not valid JSON. ` +
        "Check GEMINI_MODEL supports JSON response schemas."
    );
  }
}

function readResponseText(response: { text?: string }, context: string): string {
  const text = response.text;
  if (!text || !text.trim()) {
    throw new Error(
      `Gemini returned no ${context} text. The prompt may have been blocked by a safety filter.`
    );
  }
  return text;
}

const matchResponseSchema = z.object({
  productId: z.string().nullable().optional(),
  score: z.number().finite(),
  reason: z.string().nullable().optional()
});

const draftResponseSchema = z.object({
  comment: z.string(),
  followUp: z.string().nullable().optional()
});

/**
 * Scores a post against the candidate products. The returned product id is
 * only trusted when it appears in the candidate list; anything else becomes
 * null. The score is clamped to 0..1 because Gemini occasionally overshoots.
 */
export async function analyzePostForMatch(input: MatchPromptInput): Promise<MatchAnalysis> {
  const { system, user } = buildMatchPrompt(input);

  const response = await generateWithFallback({
    contents: user,
    config: {
      systemInstruction: system,
      responseMimeType: "application/json",
      responseSchema: MATCH_RESPONSE_SCHEMA
    }
  });

  const text = readResponseText(response, "match");
  const parsed = matchResponseSchema.safeParse(parseJsonObject(text, "match"));
  if (!parsed.success) {
    throw new Error("Gemini returned a match response in an unexpected shape.");
  }

  const candidateIds = new Set(input.candidates.map((candidate) => candidate.id));
  const requestedId = parsed.data.productId?.trim() ?? "";
  const productId = requestedId.length > 0 && candidateIds.has(requestedId) ? requestedId : null;
  const score = Math.min(1, Math.max(0, parsed.data.score));
  const reason = parsed.data.reason?.trim() || "Gemini returned no explanation.";

  return { productId, score, reason };
}

/**
 * Drafts a human-like Vietnamese comment (and, for seeding mode, a shorter
 * second-persona follow-up question). Throws a readable error when Gemini is
 * unconfigured or the response cannot be parsed; callers translate that into
 * `ActionResult` / a JSON error body rather than letting it reach the UI.
 */
export async function draftComment(input: DraftPromptInput): Promise<DraftResult> {
  const { system, user } = buildDraftPrompt(input);

  const response = await generateWithFallback({
    contents: user,
    config: {
      systemInstruction: system,
      temperature: 0.8,
      responseMimeType: "application/json",
      responseSchema: DRAFT_RESPONSE_SCHEMA
    }
  });

  const text = readResponseText(response, "draft");
  const parsed = draftResponseSchema.safeParse(parseJsonObject(text, "draft"));
  if (!parsed.success) {
    throw new Error("Gemini returned a draft response in an unexpected shape.");
  }

  const comment = parsed.data.comment.trim();
  if (!comment) throw new Error("Gemini returned an empty comment.");

  const followUpText = parsed.data.followUp?.trim() ?? "";
  // A follow-up only exists for two-tier seeding; single mode never surfaces one.
  const followUp =
    input.mode === "seeding_2_accounts" && followUpText.length > 0 ? followUpText : null;

  return { comment, followUp };
}

/**
 * Embeds text for product semantic matching. The products.embedding column is
 * `vector(768)`, so a provider/model change that emits another dimension must
 * fail loudly here instead of corrupting writes.
 */
export async function embedText(text: string): Promise<number[]> {
  const input = text.trim();
  if (!input) throw new Error("embedText requires non-empty text.");

  const response = await createClient().models.embedContent({
    model: readEmbeddingModel(),
    contents: input,
    config: { outputDimensionality: EMBEDDING_DIMENSIONS }
  });

  const values = response.embeddings?.[0]?.values;
  if (!values || values.length === 0) {
    throw new Error("Gemini returned an empty embedding.");
  }

  if (values.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Gemini returned a ${values.length}-dimension embedding; products.embedding requires ` +
        `${EMBEDDING_DIMENSIONS}. Use a 768-dim model such as ${DEFAULT_EMBEDDING_MODEL}.`
    );
  }

  return values;
}

/**
 * Body reading for the postback relay (docs/TASKS.md P2-9).
 *
 * Shopify-style relays and hand-run `curl` calls disagree about the content type, so the
 * route accepts JSON and form-encoded bodies. Pulling that out of the handler makes the
 * parsing testable without a database or a running server.
 */

export type PostbackBody = Record<string, unknown>;

export type PostbackBodyResult =
  | { ok: true; body: PostbackBody }
  | { ok: false; status: number; error: string };

export async function readPostbackBody(request: Request): Promise<PostbackBodyResult> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";

  if (contentType.includes("application/json")) {
    const text = await request.text();

    // An empty body is a validation problem, not a parse problem: let the schema report
    // the missing fields instead of a confusing "unexpected end of JSON".
    if (text.trim().length === 0) return { ok: true, body: {} };

    try {
      const parsed = JSON.parse(text) as unknown;

      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { ok: false, status: 400, error: "JSON body must be an object." };
      }

      return { ok: true, body: parsed as PostbackBody };
    } catch {
      return { ok: false, status: 400, error: "Invalid JSON body." };
    }
  }

  const form = await request.formData().catch(() => null);
  if (!form) return { ok: false, status: 400, error: "Could not read the request body." };

  const body: PostbackBody = {};
  for (const [key, value] of form.entries()) {
    // Files cannot be validated by the schema and have no meaning here.
    body[key] = typeof value === "string" ? value : null;
  }

  return { ok: true, body };
}

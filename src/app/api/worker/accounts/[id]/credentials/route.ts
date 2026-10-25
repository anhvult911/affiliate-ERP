import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { generateTotp } from "@/lib/accounts/totp";
import { decryptSecret } from "@/lib/crypto/secret-box";
import { authorizeWorker, workerJson } from "@/lib/worker/auth";

export const dynamic = "force-dynamic";

type CredentialRow = {
  id: string;
  name: string;
  platform: string;
  login_identifier: string | null;
  login_password_enc: string | null;
  twofa_secret_enc: string | null;
  proxy_host: string | null;
  proxy_port: number | null;
  proxy_username: string | null;
  proxy_password_enc: string | null;
};

/**
 * GET /api/worker/accounts/{id}/credentials
 *
 * Hands the worker what it needs to log a profile in: identifier, password, a
 * freshly generated 6-digit TOTP code and the proxy parts. Bearer-token only —
 * these values never reach the browser.
 *
 * The code is generated here (RFC 6238) instead of pasting a 2fa.live value, so a
 * login attempt always uses a code that is valid at that moment.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = authorizeWorker(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase
    .from("social_accounts")
    .select(
      "id,name,platform,login_identifier,login_password_enc,twofa_secret_enc,proxy_host,proxy_port,proxy_username,proxy_password_enc"
    )
    .eq("id", id)
    .maybeSingle()
    .overrideTypes<CredentialRow | null, { merge: false }>();

  if (error) return workerJson({ ok: false, error: error.message }, 500);
  if (!data) return workerJson({ ok: false, error: "Account not found." }, 404);

  if (!data.login_identifier) {
    return workerJson(
      { ok: false, error: "This account has no imported credentials — add it with the account import." },
      409
    );
  }

  const password = decryptSecret(data.login_password_enc);
  const twofaSecret = decryptSecret(data.twofa_secret_enc);

  if (!password) {
    return workerJson(
      {
        ok: false,
        error:
          "The stored password cannot be decrypted — ACCOUNT_CREDENTIALS_KEY changed or the record is corrupt. Re-import the account."
      },
      409
    );
  }

  let totp: { code: string; secondsRemaining: number } | null = null;
  if (twofaSecret) {
    try {
      totp = generateTotp(twofaSecret);
    } catch (caught) {
      return workerJson(
        { ok: false, error: `2FA secret is invalid: ${caught instanceof Error ? caught.message : "unknown"}` },
        409
      );
    }
  }

  return workerJson({
    ok: true,
    account: {
      id: data.id,
      name: data.name,
      platform: data.platform,
      identifier: data.login_identifier,
      password,
      totp,
      proxy: data.proxy_host
        ? {
            host: data.proxy_host,
            port: data.proxy_port,
            username: data.proxy_username,
            password: decryptSecret(data.proxy_password_enc)
          }
        : null
    }
  });
}

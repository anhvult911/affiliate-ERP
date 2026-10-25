-- Account credentials imported from the operator's `uid|password|2FA|proxy` export.
--
-- Passwords and TOTP secrets are never stored in plain text: the app encrypts them
-- with AES-256-GCM (ACCOUNT_CREDENTIALS_KEY) and only the worker, behind its bearer
-- token, can read them back. `proxy_ip` keeps the browsable endpoint (host:port) so
-- existing UI and claim payloads stay unchanged; the proxy credentials sit in their
-- own encrypted columns because a GPM-Login profile needs them separately.

alter table public.social_accounts
  add column if not exists login_identifier text,
  add column if not exists login_password_enc text,
  add column if not exists twofa_secret_enc text,
  add column if not exists proxy_host text,
  add column if not exists proxy_port int,
  add column if not exists proxy_username text,
  add column if not exists proxy_password_enc text,
  add column if not exists credentials_imported_at timestamptz;

alter table public.social_accounts
  drop constraint if exists social_accounts_proxy_port_check;

alter table public.social_accounts
  add constraint social_accounts_proxy_port_check
  check (proxy_port is null or proxy_port between 1 and 65535);

-- One Facebook login cannot be two personas: importing the same line twice is a
-- duplicate, not a second account.
create unique index if not exists social_accounts_login_identifier_key
  on public.social_accounts (platform, login_identifier)
  where login_identifier is not null;

comment on column public.social_accounts.login_password_enc is
  'AES-256-GCM ciphertext (v1.<iv>.<tag>.<ct>, base64url) of the account password.';
comment on column public.social_accounts.twofa_secret_enc is
  'AES-256-GCM ciphertext of the TOTP secret (base32, as exported for 2fa.live/Google Authenticator).';
comment on column public.social_accounts.proxy_password_enc is
  'AES-256-GCM ciphertext of the proxy password.';

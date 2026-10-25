-- Profile building: what a real visitor sees when they click the account.
--
-- Text warming alone leaves a profile with an empty avatar, no cover and no bio,
-- which is the fastest way for a human (or Facebook) to spot a farm. This adds the
-- action and the state needed to fill it in, and to show the operator how complete
-- each persona looks.

alter type public.warming_kind add value if not exists 'profile_setup';

alter table public.social_accounts
  add column if not exists bio text,
  add column if not exists avatar_set_at timestamptz,
  add column if not exists cover_set_at timestamptz,
  -- Set when a profile_setup run completed; NULL means the persona has never been
  -- dressed, which is what makes the app schedule it before any other warming.
  add column if not exists profile_built_at timestamptz;

comment on column public.social_accounts.profile_built_at is
  'Last successful profile_setup (avatar + cover + bio). NULL = never built.';

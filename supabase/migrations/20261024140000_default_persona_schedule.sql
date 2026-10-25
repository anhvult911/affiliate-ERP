-- Accounts that were warming-enabled but had no schedule.
--
-- `warmup_enabled = true` with `persona_schedule = '[]'` is a silent failure: the
-- dashboard shows a warming account, `profile_setup` still runs (it is not
-- scheduled), and no lifestyle post or cross-warm is ever queued. Imported accounts
-- and accounts created before the default existed are all in that state.
--
-- Only rows that are actually enabled are touched: an empty list on a disabled
-- account is a deliberate "do nothing" and is left alone.

update public.social_accounts
   set persona_schedule = '[{"at":"09:30","kind":"lifestyle_post"},{"at":"20:00","kind":"cross_warm"}]'::jsonb
 where warmup_enabled = true
   and persona_schedule = '[]'::jsonb;

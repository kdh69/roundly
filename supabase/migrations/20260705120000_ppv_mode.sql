-- Paid-Per-Visit (PPV) mode
-- Adds a per-user pay mode (salaried vs ppv), per-category default pay rates,
-- and an optional per-visit pay override. All additive/nullable so existing
-- rows and existing (salaried) users are unaffected until they opt in.

alter table user_settings
  add column if not exists pay_mode text not null default 'salaried',
  add column if not exists cat_pay  jsonb not null default '{}'::jsonb;

alter table visits
  add column if not exists pay numeric;

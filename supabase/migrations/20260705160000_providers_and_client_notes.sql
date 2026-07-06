-- Doctor directory + persistent client notes
--
-- Two zero-double-charting reference features:
--
-- 1. providers — a per-user directory of doctors/offices (name, specialty,
--    phone, optional NPI). A patient can be linked to MANY providers; the link
--    is stored as a jsonb array of provider ids on saved_patients.provider_ids.
--    Kept per-user for now (RLS locked to the owner); may become a shared/public
--    directory when we expand.
--
-- 2. saved_patients.notes — a persistent, free-text scratchpad that lives on the
--    CLIENT (not per-visit). Dictated with the phone keyboard mic and glanced at
--    while charting in the real EHR, so nothing here is re-typed. Distinct from
--    the per-visit visits.notes.

alter table saved_patients
  add column if not exists notes text default '';

alter table saved_patients
  add column if not exists provider_ids jsonb not null default '[]'::jsonb;

create table if not exists providers (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  specialty text default '',
  phone text default '',
  npi text default '',
  created_at timestamptz default now()
);

alter table providers enable row level security;

create policy "Users manage own providers" on providers
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

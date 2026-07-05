-- Saved-patient visit defaults
-- Let a saved patient remember the last-used visit category, type, and
-- duration, so picking a repeat patient in autocomplete pre-fills the whole
-- form (address + coords already carried), not just the address.

alter table saved_patients
  add column if not exists cat  text,
  add column if not exists type text,
  add column if not exists dur  int;

-- Backfill from each patient's most recent visit so the feature works
-- immediately for existing patients, not only after their next visit is saved.
update saved_patients sp set
  cat  = v.cat,
  type = v.type,
  dur  = v.dur
from (
  select distinct on (user_id, lower(name))
    user_id, lower(name) as lname, cat, type, dur
  from visits
  order by user_id, lower(name), date desc, id desc
) v
where v.user_id = sp.user_id and v.lname = lower(sp.name);

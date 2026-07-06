-- Patient phone (quick texts)
-- Stores an optional phone number per visit and per saved patient so the app can
-- offer one-tap SMS presets ("On my way", "Running late") and a Call action. The
-- number carries over from saved_patients into new visits via the name
-- autocomplete, and per-visit edits update the saved patient's number.

alter table visits
  add column if not exists phone text;

alter table saved_patients
  add column if not exists phone text;

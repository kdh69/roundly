-- Per-user custom visit categories and visit types.
--
-- custom_cats  : { "<key>": { "label": "<display name>", "points": <number> } }
--                A user-defined visit CATEGORY (drives points), e.g. a
--                "Palliative" category worth 1.40 pts.
-- custom_types : { "<key>": "<display name>" }
--                A user-defined visit TYPE (descriptive only, no points),
--                e.g. "Vitals Check".
--
-- Built-in categories/types stay hardcoded in the app; these columns only
-- hold the extras each user adds. Existing rows are backfilled with '{}' by
-- the DEFAULT below, and RLS already restricts every row to its owner.
alter table user_settings
  add column if not exists custom_cats  jsonb not null default '{}'::jsonb,
  add column if not exists custom_types jsonb not null default '{}'::jsonb;

-- Quick-add / needs-details
-- Supports fast partial capture: a visit added with just name + address (the
-- info that arrives piecemeal by call/email) is flagged needs_details so the
-- app can nudge the user to fill in the type/category later. Cleared when the
-- visit is opened and saved through the full edit form.

alter table visits
  add column if not exists needs_details boolean not null default false;

-- ============================================================
-- ROUNDLY DATABASE SCHEMA
-- Every table has a user_id column tied to the logged-in user,
-- and Row Level Security (RLS) policies that make it IMPOSSIBLE
-- for one user to see or modify another user's rows, even if
-- they tried to manipulate requests directly. This is what
-- makes "multiple users, no data mixing" actually safe.
--
-- HOW TO USE: Go to your Supabase project -> SQL Editor ->
-- New query -> paste this entire file -> click Run.
-- ============================================================

-- VISITS
create table visits (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  num int not null default 1,
  name text not null,
  addr text not null,
  date date not null,
  time text not null,
  dur int not null default 30,
  type text not null default 'other',
  cat text not null default 'routine',
  notes text default '',
  status text not null default 'pending',
  lat double precision,
  lng double precision,
  created_at timestamptz default now()
);

-- EXTRA PRODUCTIVITY POINTS (meetings, education, etc.)
create table extra_points (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  label text not null,
  date date not null,
  pts numeric not null,
  created_at timestamptz default now()
);

-- SAVED PATIENTS (for autocomplete)
create table saved_patients (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  addr text not null,
  lat double precision,
  lng double precision,
  created_at timestamptz default now(),
  unique(user_id, name)
);

-- PER-USER SETTINGS (point values, weekly target, home base, theme, accent)
create table user_settings (
  user_id uuid references auth.users(id) on delete cascade primary key,
  cat_points jsonb not null default '{}'::jsonb,
  weekly_target numeric not null default 30,
  home_label text default 'Charlotte, NC',
  home_lat double precision default 35.2271,
  home_lng double precision default -80.8431,
  theme_mode text default 'auto',
  accent_id text default 'navy',
  updated_at timestamptz default now()
);

-- ============================================================
-- ROW LEVEL SECURITY — this is the part that actually keeps
-- users' data separate. Without this, anyone could read
-- everyone's rows. With this, Postgres itself enforces that
-- a user can only ever see/edit rows where user_id = their own
-- logged-in id.
-- ============================================================
alter table visits enable row level security;
alter table extra_points enable row level security;
alter table saved_patients enable row level security;
alter table user_settings enable row level security;

create policy "Users manage own visits" on visits
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users manage own extra_points" on extra_points
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users manage own saved_patients" on saved_patients
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users manage own settings" on user_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

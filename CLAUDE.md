# Roundly — Project Memory

**Roundly** is a web app for home health clinicians (nurses, PTs, OTs, SLPs) to manage daily patient visit routes, track mileage, and track weekly productivity points. It's a real working app used daily by Bre (home health RN, Charlotte NC) for her job. Live at **https://roundly-app.netlify.app**.

---

## TECH STACK

| Layer | Technology |
|---|---|
| Frontend | Single-file HTML/CSS/JS (no framework, no build step) |
| Hosting | Netlify (roundly-app.netlify.app), auto-deploys from GitHub `main` |
| Auth | Supabase Google OAuth |
| Database | Supabase (Postgres) with Row Level Security |
| Maps | Leaflet.js + ESRI satellite tiles (CARTO dark tiles for street layer in dark mode) |
| Road routing | OSRM public demo server (router.project-osrm.org, no API key) — real driving route line + mileage, falls back to haversine straight-line estimates when unreachable |
| Address search | Photon by Komoot (autocomplete-friendly, no API key) — NOT Nominatim, which bans autocomplete use |
| Version control | GitHub — `github.com/kdh69/roundly` |
| Schema migrations | Supabase CLI (`supabase/` folder), linked to the remote project |

---

## SUPABASE PROJECT

- **Project URL:** `https://wxhjfeorwwvruibuvgta.supabase.co`
- **Anon public key:** `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind4aGpmZW9yd3d2cnVpYnV2Z3RhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE5MzQ2MTEsImV4cCI6MjA5NzUxMDYxMX0.rQNUX3j7LwPD4Dhdqg5DIaLHnsCwc0bC_9ejwkJH77U` — safe to keep in client code and commit; real protection is RLS on the DB, not key secrecy. Never commit a `service_role` key if one is ever introduced; that one is genuinely secret.
- **Auth provider:** Google OAuth (configured in both Supabase dashboard and Google Cloud Console)
- **Redirect URL:** `https://roundly-app.netlify.app/**` — must match exactly in both Supabase and Google Cloud Console

### Database tables (all RLS-enabled, schema in `supabase_schema.sql` / `supabase/migrations/`)

```
visits          — patient visits (user_id, num, name, addr, date, time, dur, type, cat, notes, status, lat, lng, pay, phone)
extra_points    — non-visit productivity (user_id, label, date, pts)
saved_patients  — autocomplete history (user_id, name, addr, phone, lat, lng) — unique per user+name
user_settings   — per-user config (user_id, cat_points jsonb, weekly_target, home_label/lat/lng, theme_mode, accent_id, pay_mode, cat_pay jsonb)
```

**Visit `status`** is free-text: `pending` (default) → `confirmed` (patient confirmed the appt — still counts for points and stays in the route) → `done`, plus `skipped` (dropped from route/points/mileage). Only `skipped` is excluded from point/pay totals; helpers to toggle: `markDone()`, `markConfirmed()`, `markSkip()`.

RLS policy pattern on every table: `for all using (auth.uid() = user_id) with check (auth.uid() = user_id)` — a user can only ever see/edit their own rows, enforced by Postgres itself.

---

## VISIT CATEGORY POINT VALUES (defaults — configurable per user in Settings)

| Category | Points |
|---|---|
| SOC (Start of Care) | 2.50 |
| ROC (Return to Care) | 1.75 |
| Recertification | 1.75 |
| Agency Discharge | 1.50 |
| Discipline Discharge | 1.50 |
| Non-OASIS SOC | 1.50 |
| Discipline Eval | 1.25 |
| IV / High Acuity | 1.25 |
| Routine Visit | 0.90 |

Weekly target: **30 points** (configurable per user in Settings).

**Pay mode (salaried vs PPV):** a per-user Settings toggle (`pay_mode`, default `salaried`). In **PPV (Paid-Per-Visit)** mode each category also has a default dollar rate (`cat_pay` jsonb, edited in Settings), auto-filled into each visit and overridable per-visit (`visits.pay`; blank/null = use the category default via `getPay()`). Salaried mode is unchanged (points only). PPV additionally shows dollars alongside points — a header earnings strip (day/week), a pay chip per visit card, per-day/week earnings in the Points and Summary views, and pay in the exported summary. Helpers: `isPPV()`, `getPay(v)`, `calcDayPay()`, `calcWeekPay()`, `fmtMoney()`.

---

## APP FEATURES (fully built)

- Google sign-in via Supabase OAuth, per-user data separation via RLS
- Visit management — add/edit/delete visits with address, time, type, category, notes
- Address autocomplete via Photon, biased toward home base location
- Saved patients — repeat-patient autocomplete by name, auto-fills address
- Date navigation — view/add visits for any date (date strip in Visits tab)
- Route map — Leaflet satellite/street/hybrid, pins + road-following route line (OSRM), next-stop pin highlighted, date strip on the map, Confirm/Done/Edit/Navigate from pin popups, layer choice remembered per device
- Route optimization — nearest-neighbor + 2-opt improvement; optimized days follow the stored visit `num` order (flag kept in localStorage per device), all other days follow appointment-time order (`routeVisits()` is the single source of driving order)
- Miles-saved payoff — after optimizing, the list shows a banner + toast with the estimated miles saved vs. driving in appointment-time order (`estSavedMiles()`; straight-line haversine estimate, always labeled `~`)
- Visit confirmation — a `confirmed` status (patient confirmed the appt) between pending and done; distinct blue styling on cards/hero/pins/calendar and a count in the day Summary
- Quick texts — optional per-patient phone (`visits.phone`, carried from `saved_patients`) powers a 💬 action on cards + next-stop hero: a bottom-sheet with Call, "On my way", "Running late", and a custom message, all via `sms:`/`tel:` deep links (`openQuickText()`, `smsHref()`)
- Mileage tracking — real road distance via OSRM (round trip from home base), haversine straight-line as offline fallback; UI labels which one is showing
- Productivity points — per-visit points auto-calculated by category, configurable per user
- Pay mode (salaried / PPV) — optional Paid-Per-Visit tracking: per-category dollar rates, per-visit override, day/week earnings shown alongside points (see Pay mode note above)
- Extra points — non-visit productivity (meetings, education, training) toward weekly goal
- Weekly progress — progress bar toward target, browsable week-by-week, with a "points to go → visits needed" forecast line
- Calendar view — month + week views with visit dots and daily point totals
- Light/dark mode — auto (follows system) or manual override
- Color themes — 7 accent options (Sunset default, Ocean, Teal, Plum, Rose, Forest, Slate); "soft sunset" visual system: ambient accent-tinted glow blobs painted on `#app`, borderless cards with warm soft shadows, gradient primary actions via the `--accent-grad` token (derived from each accent's two stops)
- PIN lock — local quick-lock per device (localStorage keyed to Google account ID)
- Backup/restore — export all data as JSON, restore merges into current account
- Export — daily route summary (mileage, points, and pay in PPV mode) via native share sheet on mobile (`navigator.share`), `.txt` download fallback on desktop
- PWA ready — `manifest.json` for Add to Home Screen on iOS/Android

---

## FILE STRUCTURE

```
roundly/
├── index.html               # Entire app — HTML + CSS + JS in one file
├── manifest.json             # PWA manifest for home screen install
├── supabase_schema.sql       # Original DB schema dump, kept for reference
├── supabase/                 # Supabase CLI project (migrations, config)
│   ├── config.toml
│   └── migrations/
├── .gitignore
└── CLAUDE.md                 # This file
```

---

## STANDING RULES FOR ALL SESSIONS

- The app is a **single HTML file** — all CSS and JS is inline, no build step, no bundler. **Never split it into separate files** unless explicitly decided together as a deliberate refactor.
- Before considering any edit to `index.html` done, validate balanced `{}` braces, `()` parens, and `<div>` tags.
- The app is used by real clinicians for real patient data — test carefully before deploying.
- Date strings must be built from LOCAL date parts (use the `toDateStr()` helper) — never `toISOString().slice(0,10)`, which is UTC and flips "today" to tomorrow after ~7-8 PM Eastern.
- Address search must stay on Photon (photon.komoot.io), not Nominatim.
- Google OAuth redirect URL must stay in sync as `https://roundly-app.netlify.app/**` in both Supabase and Google Cloud Console.
- Schema changes should go through Supabase CLI migrations (`supabase/migrations/`), not the raw SQL editor, so history stays tracked in git.
- `git push` to `main` auto-deploys to `roundly-app.netlify.app` via the Netlify GitHub integration — no manual uploads needed.

---

## MAKING A SCHEMA CHANGE

Each contributor links the CLI once per machine, then applies changes as tracked migrations:

```
npx supabase login                                            # once per machine, own access token
npx supabase link --project-ref wxhjfeorwwvruibuvgta -p <db password>   # once per machine
npx supabase migration new <short_description>                # creates supabase/migrations/<ts>_<name>.sql
# edit the generated SQL file
npx supabase db push                                           # applies it to the shared remote DB
git add supabase/migrations/ && git commit && git push          # so the change is tracked in history
```

---

## COLLABORATORS

- **Bre Huntzinger** (brehuntzinger@gmail.com, GitHub `brehuntz`) — primary developer, home health RN, Charlotte NC
- **Kyle** (husband) — collaborator; repo lives under his GitHub account (`kdh69/roundly`), Bre has push access
- Both share the same Supabase project but have separate Google accounts / separate data rows in the app (enforced by RLS)

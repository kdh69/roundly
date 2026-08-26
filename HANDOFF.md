# Roundly — Session Handoff

Snapshot of where the app stands and everything still open, so any chat (or person) can pick up cleanly. Pair this with **CLAUDE.md** (durable project facts + rules) and **PLAN.md** (the friction-reduction slice plan). Last updated **2026-08-26**.

---

## Current state

- **Live:** https://roundly-app.netlify.app — auto-deploys from GitHub `main`.
- **`main` is clean and in sync** after the 2026-08-26 docs commit. The last code commit is the HIPAA-hardening commit `edc635e` (verified live: security headers serving, all `/vendor/` assets 200).
- **Real production app** used daily by Bre (home health RN). Test carefully; no reckless changes.
- ⚠️ **The git history is tangled** from multiple parallel Claude chats working the same single `index.html` — commit *order* in `git log` does **not** reliably reflect chronology, and one chat's commit can sweep another's uncommitted edits (it happened once: the sort-dropdown work landed inside commit `4ae1c97 "Fix past visits vanishing…"`). **Trust the working tree / a quick feature grep over the git log.** Verify features by reading the current file, not by reading commit messages.
- **Go-to-market is the active thread.** Kyle wants to sell Roundly. Code-side HIPAA hardening is done; what remains is vendor/infra + paperwork (see "Go-to-market" below). That list is the most important thing in this file.

---

## What's live now (feature inventory)

Everything below is in production `main`.

**Core (long-standing):** Google OAuth + per-user RLS · visit add/edit/delete · Photon address autocomplete · date navigation · Leaflet route map (satellite/street/hybrid, OSRM road line) · route optimization (NN + 2-opt) · mileage (OSRM + haversine fallback) · productivity points (per-category, configurable) · extra points · weekly progress · calendar (month/week) · light/dark + 7 accent themes · PIN lock · backup/restore · PWA.

**Shipped by the friction plan:**
- **PPV / pay mode** — salaried vs Paid-Per-Visit toggle; per-category `$` rates auto-filled + per-visit override; dollars shown alongside points everywhere (`isPPV()`, `getPay()`, `calcDayPay/WeekPay`, `fmtMoney()`).
- **Points forecast** — "X to go — about N <low cat> or M <high cat>" under the weekly bar.
- **Share-sheet export** — `navigator.share` on mobile, `.txt` download on desktop.
- **Saved-patient defaults** — repeat patient auto-fills address + category + type + duration (+ pay rate) from history (`applyPatientDefaults()`).
- **Next-stop hero card** — big "Next stop" card atop today's list with Navigate + Mark-done; "Route done" strip when complete.
- **Quick add** — ⚡ FAB captures name + address fast; visit flagged `needs_details` with a chip + tap-to-complete nudge until finished (`openQuickAddPanel()`, `applyQuickMode()`).
- **Delete + undo** — no blocking confirm; delete is instant with a 6s Undo bar (`showUndoToast`, `restoreDeletedVisit`).
- **Bigger tap targets** + **sort dropdown** + **FAB fix** (add FABs are Visits-only, un-stacked, list has bottom padding).

**Shipped by the parallel "Phase" / feature chats:**
- **Drive Mode** — full-screen, one-stop-at-a-time hands-free view; Navigate/Text/Call + Confirm/Done/Skip, auto-advance, swipe between stops, **live arrival detection** (`watchPosition` → `driveWatchId`/`onDrivePos`).
- **Confirmed status** (pending → confirmed → done) with distinct styling.
- **Quick texts** — per-patient phone → Call / "On my way" / "Running late" / custom via `sms:`/`tel:`.
- **Miles-saved payoff** banner after optimizing.
- **Offline reliability** — `sw.js` network-first app shell + `outbox` write queue + refetch-on-return.
- **Doctor directory + client notes** — NPPES lookup via `netlify/functions/npi.js` (no PHI through the proxy).

**HIPAA hardening (commit `edc635e`) — all UX-invisible:**
- **Self-hosted libs** — `vendor/` holds Leaflet 1.9.4, supabase-js **2.110.5** (was an unpinned `@2` from unpkg), Nunito woff2s. No CDN/Google Fonts requests remain. `sw.js` cache bumped to `roundly-shell-v2`; `/vendor/` is cache-first and precached.
- **Security headers** in `netlify.toml` — enforced **CSP allowlist** (every external host listed; unlisted = blocked by the browser), HSTS, nosniff, `X-Frame-Options: DENY`, Referrer-Policy, Permissions-Policy. The Census geocoder is JSONP so it lives in `script-src`, not `connect-src`.
- **PIN** — salted SHA-256 via WebCrypto (`hashPin`/`pinMatches`); old `simpleHash` values (`h…`) verify once and are transparently upgraded to `s…` on the next successful unlock; 5 misses → doubling lockout 30s→8m cap (`getPinFails`/`setPinFails`, localStorage `roundlyPinFails_<uid>`).
- **Idle re-lock** — with a PIN set, re-locks after 15 min without interaction or on return to foreground after 15+ min (`maybeIdleLock`, `IDLE_LOCK_MS`). **Never fires while `driveIsOpen()`.** No PIN → no change.
- **Outbox purge** — `purgeOutboxLocal()` runs on every sign-out path (Settings sign-out after a best-effort `flushOutbox()`, forgot-PIN, data deletion). The outbox holds patient names/addresses/notes in plain localStorage while a session is live.
- **Delete all my data** — Settings → Account (`deleteAllMyData()`): confirm + type `DELETE`, deletes the user's rows from `visits`, `extra_points`, `saved_patients`, `providers`, `user_settings`, clears local PIN/outbox, signs out. The auth user itself can't be deleted client-side (needs service role) — a re-sign-in simply starts empty.

---

## Tests

`tests/hipaa_tests.js` — a Node VM harness that loads the whole inline script from `index.html` with stubbed browser globals and exercises the PIN hash/migration/backoff, outbox purge, idle re-lock (incl. the Drive Mode guard), and data deletion. **Run `node tests/hipaa_tests.js` after touching anything in the PIN / lock / outbox / sign-out areas** — 20 tests, all passing at HEAD. Same pattern the Phase reviews used (fixtures must run *inside* the VM context to reach top-level `let`s). `netlify.toml` 404s `/tests/*` so it isn't served publicly.

Static checks used on every `index.html` change: extract inline `<script>` → `node --check`, and `<div>` open/close count (367/367 at HEAD).

---

## Database / migrations (all applied to remote)

Migrations live in `supabase/migrations/` and are all pushed to the remote DB:
`initial_schema` · `add_custom_cats_types` · `ppv_mode` (`visits.pay`, `user_settings.pay_mode`/`cat_pay`) · `saved_patient_defaults` (`saved_patients.cat/type/dur`) · `quick_add` (`visits.needs_details`) · `patient_phone` (`visits.phone`) · `providers_and_client_notes`.

**Deploy rule that bit us before:** a migration that adds columns the code writes **must be applied before the code deploys** (git push auto-deploys). Apply with the CLAUDE.md runbook: `npx supabase db push`. Verify a new column resolves via PostgREST (200) before relying on it.

---

## Outstanding

### Go-to-market / HIPAA — THE ACTIVE THREAD (business + infra; code side is done)

Context: 2026-08-26 audit. Roundly stores patient names, addresses, phones, notes = PHI. Selling it makes Roundly a **business associate**. Kyle's reaction: compliance felt like "a little much." Reframe agreed: **the $599/mo Supabase Team + HIPAA add-on is Supabase's price, not HIPAA's price** — AWS/GCP/Firebase sign BAAs for free. Competitor **ZigBuddy** (zigbuddy.com/security) shows the target posture: sells to individual clinicians, says "HIPAA-**aligned**" (not "compliant"), encrypts, US-only data, and **offers a BAA to any agency that asks**. Mirror that.

What's still open, in order:
1. **Database under a BAA.** Options: (a) keep managed Supabase → Team plan + HIPAA add-on + signed BAA (~$599/mo, mark project HIPAA, dashboard MFA enforced); (b) self-host Supabase on AWS/GCP under their free BAA; (c) migrate to Firebase/RDS. Decision is Kyle's; (b)/(c) are code+ops work a session can do once chosen.
2. **Stop sending patient addresses/coords to no-BAA vendors.** Today: **Photon** (`photonSearch`, every keystroke), **Census geocoder** (JSONP fallback, `geocoding.geo.census.gov`), **OSRM public demo** (`osrmRoute`, the full day's coords). Fix = self-host OSRM + Photon on a ~$20/mo VPS inside the BAA'd cloud (or Geocodio, which offers a BAA). **Independent launch risk:** the OSRM demo policy is non-commercial-only, 1 req/s, revocable without notice. When done: update `connect-src` in `netlify.toml` and the CLAUDE.md Photon rule.
3. **Netlify:** either the enterprise HIPAA/BAA offering, or a written analysis that no PHI touches Netlify (PHI flows browser↔Supabase; Netlify serves static files + the no-PHI NPI proxy). Needs to be on paper either way.
4. **Paperwork:** customer-facing BAA template, Security Risk Analysis (free HHS SRA tool), breach-notification plan, **privacy policy + terms of service in the app**, honest security page ("HIPAA-aligned safeguards"). Never say "HIPAA compliant" in marketing until 1–3 are done (FTC deceptive-practices exposure). **Recommended: one hour with a healthcare attorney on positioning before launch.**
5. **Accepted-risk disclosures to document:** map tiles (ESRI/OSM/CARTO tile requests centered on patient homes + user IP), Google Maps navigation handoff (`navTo` puts the address in a URL), Open-Meteo (clinician's own home coords only — not PHI), NPI proxy (doctor names only).
6. **Separate dev from prod.** Kyle + Bre develop against the production Supabase project; dashboard/service-role access sees every user's rows. Before customers: a second Supabase project for dev, restricted + logged dashboard access, keep Supabase connection/audit logging on.
7. **Positioning:** sell to individual clinicians as a personal route planner *and* offer a BAA to agencies — avoid being pure shadow-IT that a compliance officer bans agency-wide. The FTC Health Breach Notification Rule applies to consumer health apps regardless of HIPAA.
8. **Optional later:** proxy Photon/OSRM through Netlify functions (strips user IP) — rejected for now because autocomplete-per-keystroke would burn function quota and add latency.

### Testing
9. **On-device check after the CSP deploy (not yet done).** The CSP is enforced in production; a missed host would surface as a silently blocked request. Bre should do a 30-second phone pass: sign in (Google avatar loads), map tiles in light + dark, address search, weather chip, Navigate handoff, PIN unlock. Everything so far was verified by host enumeration + curl only.
10. **Broader on-device pass still recommended.** PPV mode end-to-end, quick-add → nudge → complete, delete → undo, Drive Mode arrival — a lot shipped without real-device verification (the app is OAuth-gated so a chat can't drive it).

### Product / needs Bre
11. **Quick-add ease-of-use workshop (the big one).** The `needs_details` foundation is shipped; open design decisions to make *with her*: should quick-adding a **known** saved patient skip the flag? Should `needs_details` visits **count toward** weekly points/pay before completion (currently yes, at the placeholder category)? Capture-from-notification shortcuts; truly optional type/category vs placeholder-defaulted.
12. **Verify Drive Mode arrival detection in the field** before building anything new there.

### Platform / packaging — "make it an iPhone app" (DIRECTION CHOSEN 2026-08-26; no code started)

The app is already an installable, offline-capable PWA — `sw.js`, `manifest.json` (`display: standalone`), `apple-mobile-web-app-*` meta, all icons. **Bre already runs it as an installed PWA (Add to Home Screen).** So the base route is done; the question was whether to go native.

**Decision (Kyle, 2026-08-26):** pursue a **Capacitor wrapper → TestFlight**, for two reasons — (a) Kyle wants the real iOS-pipeline reps (his Apple Developer account was just approved; he's already shipped one Xcode app + one Expo app to learn), and (b) some features are genuinely better native, chiefly **Drive Mode** (screen keep-awake + real background GPS, which Safari throttles/kills). Distribution target is **TestFlight**, not the public App Store — this is for Bre to use/test as a real app, and the HIPAA items above block a public listing anyway.

**Expo was explicitly rejected** for Roundly: Expo/React Native means rewriting the whole single-file app in RN components. **Capacitor wraps the existing `index.html` unchanged** — the correct tool here. (Kyle's Expo app is a separate learning exercise, not Roundly.)

Agreed architecture when the work starts:
- **Separate `roundly-ios/` folder or repo** — do NOT drop `package.json` + `ios/` into the app repo root: Netlify auto-deploys that repo and a `package.json` can make it start running a build. Keeping the wrapper separate also respects the "single `index.html`, no build step" rule for the web app.
- **Bundle `index.html` locally** (Capacitor `webDir: www`), NOT `server.url` → Netlify. Local bundling is where native plugins (keep-awake, geolocation) behave, works fully offline, and is the more instructive rep. Trade-off: pushing web changes into the app is a `npx cap copy && npx cap sync` + re-upload, not automatic. (`server.url` pointed at Netlify would auto-update but complicates native plugins and reads as "just a website" to App Review — fine only for TestFlight if we later want auto-update.)
- **Native plugins:** `@capacitor/keep-awake` (wire into `enterDriveMode`/`exitDriveMode`), `@capacitor/geolocation` (background GPS for arrival detection). Add the location + background-mode capabilities and Info.plist usage strings (`NSLocationWhenInUseUsageDescription`, `NSLocationAlwaysAndWhenInUseUsageDescription`) in Xcode.
- **Google OAuth:** the Supabase OAuth redirect must resolve back inside the WKWebView. Verify the redirect (`roundly-app.netlify.app/**`) completes in the native shell; a custom URL scheme / `ASWebAuthenticationSession` tweak may be needed. **Test this first — it's the most likely breakage.**
- **TestFlight realities:** builds expire ~90 days (re-upload to refresh); invite Bre as an internal/external tester; each native-code change needs a new Archive + upload.

**Rough flow:** `npm i @capacitor/core @capacitor/cli @capacitor/ios @capacitor/keep-awake @capacitor/geolocation` → `npx cap init Roundly app.roundly.mobile --web-dir=www` → copy `index.html`+`vendor/`+`manifest.json` into `www/` → `npx cap add ios` → `npx cap sync ios` → `npx cap open ios` → set signing team → Archive → TestFlight.

**No code started.** Next session can scaffold `roundly-ios/` (config + `www/` copy + keep-awake wired into Drive Mode + Info.plist strings) on request. A full native rewrite remains **not recommended**.

### Code cleanups (small, safe)
13. **Map-view direction button label** — the Map controls button still reads "🕐 Earliest first" vs the list's "🕐 Earliest"; shorten to match.
14. **`calcDayPay`/`calcWeekPay` duplication** — a shared `visitsForDay/Week` helper would DRY these with `calcDayPoints`/`calcWeekVisitPoints`. Only if that area is touched again.

### Process
15. **Parallel-chat coordination.** Only one chat commits at a time, commit each change immediately, `git fetch` + `git status` before editing. Feature overlap matters as much as line overlap. Captured in memory `roundly-parallel-dev`.
16. **Any new external host** → add to the `netlify.toml` CSP *and* check BAA status first (CLAUDE.md rule).

---

## Doc map

- **CLAUDE.md** — durable project facts, schema, standing rules, migration runbook. Read first.
- **PLAN.md** — the friction-reduction slice plan; essentially complete (the quick-add workshop is the main remaining item).
- **HANDOFF.md** — this file: current-state snapshot + outstanding.
- **tests/hipaa_tests.js** — VM harness for the PIN/lock/outbox/deletion code paths.
- **Memory** (`~/.claude/.../memory/`): `roundly-hipaa-status` (go-to-market blockers + the cheap-cloud reframe), `roundly-parallel-dev` (coordination), `roundly-review-roadmap` (the Phase 0–3 review), `roundly-doctors-notes-feature`, `roundly-ios-packaging`.

## Suggested first steps for the next session
1. `git fetch` + confirm `git status` clean and even with origin before touching anything.
2. Read the current `index.html` for any feature you're about to change — don't trust git-log order.
3. **If the task is go-to-market:** get Kyle's decision on item 1 (which BAA'd database path), then do item 2 (self-host OSRM + Photon, update CSP + CLAUDE.md rule). That's the code work that unblocks everything else.
4. If the task is quick-add: it's a **workshop with Bre**, not a solo build.
5. For anything touching Drive Mode / offline / arrival / PIN: run `node tests/hipaa_tests.js` after, and coordinate — those areas came from other chats.

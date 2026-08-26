# Roundly — Session Handoff

Snapshot of where the app stands and everything still open, so any chat (or person) can pick up cleanly. Pair this with **CLAUDE.md** (durable project facts + rules) and **PLAN.md** (the friction-reduction slice plan).

---

## Current state

- **Live:** https://roundly-app.netlify.app — auto-deploys from GitHub `main`.
- **`main` is clean and in sync** (working tree empty, local == origin, everything pushed). HEAD at the HIPAA-hardening commit (`edc635e`).
- **Real production app** used daily by Bre (home health RN). Test carefully; no reckless changes.
- ⚠️ **The git history is tangled** from multiple parallel Claude chats working the same single `index.html` — commit *order* in `git log` does **not** reliably reflect chronology, and one chat's commit can sweep another's uncommitted edits (it happened this session: the sort-dropdown work landed inside commit `4ae1c97 "Fix past visits vanishing…"`). **Trust the working tree / a quick feature grep over the git log.** Verify features by reading the current file, not by reading commit messages.

---

## What's live now (feature inventory)

Everything below is in production `main`.

**Core (long-standing):** Google OAuth + per-user RLS · visit add/edit/delete · Photon address autocomplete · date navigation · Leaflet route map (satellite/street/hybrid, OSRM road line) · route optimization (NN + 2-opt) · mileage (OSRM + haversine fallback) · productivity points (per-category, configurable) · extra points · weekly progress · calendar (month/week) · light/dark + 7 accent themes · PIN lock · backup/restore · PWA.

**Shipped by the friction plan (this line of work):**
- **PPV / pay mode** — salaried vs Paid-Per-Visit toggle; per-category `$` rates auto-filled + per-visit override; dollars shown alongside points everywhere (`isPPV()`, `getPay()`, `calcDayPay/WeekPay`, `fmtMoney()`).
- **Points forecast** — "X to go — about N <low cat> or M <high cat>" under the weekly bar.
- **Share-sheet export** — `navigator.share` on mobile, `.txt` download on desktop.
- **Saved-patient defaults** — repeat patient auto-fills address + category + type + duration (+ pay rate) from history (`applyPatientDefaults()`).
- **Next-stop hero card** — big "Next stop" card atop today's list with Navigate + Mark-done; "Route done" strip when complete.
- **Quick add** — ⚡ FAB captures name + address fast; visit flagged `needs_details` with a chip + tap-to-complete nudge until finished (`openQuickAddPanel()`, `applyQuickMode()`).
- **Delete + undo** — no blocking confirm; delete is instant with a 6s Undo bar (`showUndoToast`, `restoreDeletedVisit`).
- **Bigger tap targets** + **sort dropdown** (replaced the pill cluster) + **FAB fix** (add FABs are Visits-only, un-stacked, list has bottom padding so they don't cover content).

**Shipped by the parallel "Phase" / feature chats:**
- **Drive Mode** — full-screen, one-stop-at-a-time hands-free view; Navigate/Text/Call + Confirm/Done/Skip, auto-advance, swipe between stops, **live arrival detection** (`watchPosition` → `driveWatchId`/`onDrivePos`).
- **Confirmed status** (pending → confirmed → done) with distinct styling.
- **Quick texts** — per-patient phone → Call / "On my way" / "Running late" / custom via `sms:`/`tel:`.
- **Miles-saved payoff** banner after optimizing.
- **Offline reliability** — `sw.js` network-first app shell + `outbox` write queue + refetch-on-return.
- **Doctor directory + client notes** — NPPES lookup via `netlify/functions/npi.js` (no PHI through the proxy).
- **HIPAA hardening** — self-hosted `vendor/` libs (no CDN), CSP allowlist in `netlify.toml`, PIN upgrade, idle lock, data controls.

---

## Database / migrations (all applied to remote)

Migrations live in `supabase/migrations/` and are all pushed to the remote DB:
`initial_schema` · `add_custom_cats_types` · `ppv_mode` (`visits.pay`, `user_settings.pay_mode`/`cat_pay`) · `saved_patient_defaults` (`saved_patients.cat/type/dur`) · `quick_add` (`visits.needs_details`) · `patient_phone` (`visits.phone`) · `providers_and_client_notes`.

**Deploy rule that bit us before:** a migration that adds columns the code writes **must be applied before the code deploys** (git push auto-deploys). Apply with the CLAUDE.md runbook: `npx supabase db push` (the CLI is already logged in; linking used an empty DB password over the pooler — no secret needed). Verify a new column resolves via PostgREST (200) before relying on it.

---

## Outstanding

### Product / needs Bre
1. **Quick-add ease-of-use workshop (the big one).** Bre said ease-of-use will be a major win. The `needs_details` foundation is shipped; open design decisions to make *with her*:
   - Should quick-adding a **known** saved patient skip the `needs_details` flag (details already back-filled)? Currently it always flags.
   - Should `needs_details` visits **count toward** weekly points/pay totals before they're completed? Currently they count at the placeholder (lowest) category.
   - Capture-from-notification shortcuts; whether visit type/category should be truly optional (null) vs placeholder-defaulted.
2. **Verify Drive Mode arrival detection in the field.** Phase 3's `watchPosition` arrival detection supersedes the old "Slice 6" list-banner idea. Confirm what it actually does on arrival (auto-advance? prompt? just recenter?) and whether Bre wants a one-tap "mark done on arrival." Decide *before* building anything new here — and route any Drive Mode edits through whoever owns that code.

### Code cleanups (small, safe)
3. **Map-view direction button label** — the Map controls button (`index.html` ~line 830) still reads "🕐 Earliest first" while the list one is "🕐 Earliest"; they converge after one toggle (`updateVisitNumDirBtn`). Trivial: shorten the Map one's initial text to match.
4. **`calcDayPay`/`calcWeekPay` duplication** — they repeat the day/week visit-filter predicates already in `calcDayPoints`/`calcWeekVisitPoints`. A shared `visitsForDay/Week` helper would DRY all four. Non-blocking; do it only if that area is touched again.

### Testing
5. **On-device pass recommended.** A lot shipped without real-device verification (the app is Google-OAuth-gated, so a chat can't drive it). Worth a phone click-through of: PPV mode end-to-end, quick-add → nudge → complete, delete → undo, and Drive Mode arrival. Static checks done each change were JS-parse (`new Function`) + `<div>` balance only.

### Go-to-market (not code; tracked in memory `roundly-hipaa-status`)
6. **HIPAA for commercial use is NOT complete.** Code-side hardening shipped, but outstanding: Supabase Team plan + HIPAA add-on + BAA; replacing the public OSRM demo + Photon (which receive patient addresses/coords) with self-hosted / BAA-covered services; and business paperwork (customer BAAs, risk analysis, privacy policy). Fine for Bre's personal use; a blocker before selling to other clinicians.

### Process
7. **Parallel-chat coordination.** Multiple chats editing one `index.html` collide (see the `4ae1c97` sweep above). Rule of thumb: only one chat commits at a time, commit each change immediately, and `git fetch` + check `git status` before editing. Feature overlap matters as much as line overlap (e.g. Drive Mode's swipe made the planned list-swipe redundant → it was dropped). Captured in memory `roundly-parallel-dev`.

---

## Doc map

- **CLAUDE.md** — durable project facts, schema, standing rules, migration runbook. Read first.
- **PLAN.md** — the friction-reduction slice plan; now essentially complete (Slices 6/7 were overtaken by the parallel Phase work; the quick-add workshop is the main remaining item).
- **HANDOFF.md** — this file: current-state snapshot + outstanding.
- **Memory** (`~/.claude/.../memory/`): `roundly-parallel-dev` (coordination), `roundly-hipaa-status` (go-to-market blockers), `roundly-review-roadmap` (the Phase 0–3 review), `roundly-doctors-notes-feature`.

## Suggested first steps for the next session
1. `git fetch` + confirm `git status` clean and even with origin before touching anything.
2. Read the current `index.html` for any feature you're about to change — don't trust git-log order.
3. If the task is quick-add: this is a **workshop with Bre**, not a solo build — come with 2–3 concrete UX options for the open decisions above.
4. For anything touching Drive Mode / offline / arrival: coordinate, since those came from other chats.

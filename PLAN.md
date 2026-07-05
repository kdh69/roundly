# Roundly — Friction-Reduction Plan (July 2026)

Execution plan for reducing daily-use friction. Written for an implementing session to follow slice-by-slice, and for a reviewing session to check work against.

## Progress log
- **Shipped:** PPV feature (see "Slice PPV") + Slice 2 (points forecast + share-sheet export). Migration `20260705120000_ppv_mode.sql` applied to remote DB (verified: `visits.pay`, `user_settings.pay_mode`/`cat_pay` resolve via PostgREST). High-effort self-review run (8 finder angles); fixes applied: restore now re-applies `payMode`/`catPay`; export share-sheet gated to mobile UA so desktop keeps `.txt`; negative per-visit pay clamped to null; `cat_pay` jsonb reads coerced with `Number()`; forecast generalized off the hardcoded `routine` key.
- **Deferred cleanup (non-blocking):** `calcDayPay`/`calcWeekPay` duplicate the day/week visit-filter predicates already in `calcDayPoints`/`calcWeekVisitPoints` — a shared `visitsForDay/Week` helper would DRY all four. Left as-is to match the existing points helpers; revisit if that area is touched again.
- Slices 1, 3, 4, 6, 7 and the gate remain open.

---

## Slice PPV — Salaried vs Paid-Per-Visit mode

**Status:** [x] implemented (pending migration apply + deploy) — **needs Fable review**

Per-user Settings toggle `pay_mode` (`salaried` default | `ppv`). Decisions locked with the user: per-category default rates (auto-filled, per-visit editable) and **show both** dollars and points in PPV mode.

- **Migration** `20260705120000_ppv_mode.sql`: `user_settings.pay_mode text`, `user_settings.cat_pay jsonb`, `visits.pay numeric`.
- **State:** `payMode`, `catPay`; loaded/saved in `loadAllDataFromSupabase`/`saveUserSettings`; in backup/restore.
- **Helpers:** `isPPV()`, `getPay(v)` (per-visit override → category default → 0), `calcDayPay()`, `calcWeekPay()`, `fmtMoney()`.
- **Settings:** pay-mode toggle (`setPayMode`), per-category `$` rate editor (`settings-pay-section`, `spay-<k>` inputs), `applyPayModeUI()` toggles PPV-only UI.
- **Visit form:** `#f-pay` field in `#pay-field-wrap` (shown only in PPV); blank = use category default; placeholder shows the default (via `updatePtsPreview`).
- **Displays (PPV only):** header `#earnings-strip` (day/week $), `.tag-pay` chip per visit card, per-day `.day-pay-pill` + week earnings row in Points view, day/week pay rows + per-visit $ in Summary, `$` in exported summary.

Verification checklist:
- [ ] Migration applied to remote DB; a visit saves without error (proves `pay` column exists).
- [ ] Salaried mode is visually identical to before (no earnings strip, no pay tags, no pay field).
- [ ] Toggle to PPV in Settings → set category rates → save → earnings strip + pay tags appear; new visit auto-fills the category rate, override sticks; blank field falls back to default.
- [ ] Points/Summary/export all show dollars in PPV, none in salaried.
- [ ] Backup/restore round-trips pay_mode/cat_pay/visit pay.
- [x] Brace/paren/div validation (JS parses clean, divs balanced).

**How to use this document:**
- Implement one slice at a time, in order. Each slice is independently shippable — commit and push after each one (Netlify auto-deploys `main`).
- Line numbers below are approximate and WILL drift as slices land — anchor on **function names**, not line numbers.
- After each slice: run the verification checklist at the bottom of the slice, then mark the slice's checkbox here and commit `PLAN.md` with the change.
- Two items are **gated on questions for Bre** (see "Gate" section). Do not build Slice 5 before the gate is answered.

**Cut from an earlier draft — do NOT build:** voice input (Web Speech API too flaky on iOS Safari), background GPS trip recorder (iOS Safari kills `watchPosition` when screen locks — a browser app cannot do MileIQ-style tracking; do not attempt).

---

## Standing rules (from CLAUDE.md — apply to every slice)

- App is a single `index.html` — all CSS/JS inline. (Exception: Slice 7 adds `sw.js`, because a service worker must be a separate file. That is the only new file allowed.)
- Validate balanced `{}`, `()`, and `<div>` tags before considering any edit done.
- Date strings from LOCAL parts via `toDateStr()` — never `toISOString().slice(0,10)`.
- Address search stays on Photon. Schema changes via `supabase/migrations/` (see CLAUDE.md "MAKING A SCHEMA CHANGE" runbook).
- Real patient data — every batch/automatic action needs a user confirmation step.

---

## Slice 1 — Saved-patient autocomplete carries category/type/duration

**Goal:** picking a repeat patient by name fills the WHOLE form (address, coords, category, visit type, duration), not just the address. Repeat-visit entry drops from ~5 fields to ~1 tap + Save.

**Status:** [x] shipped — migration `20260705130000_saved_patient_defaults.sql` applied (backfilled from each patient's most recent visit via `DISTINCT ON`). `savedPatients` carry `cat/type/dur`; `upsertSavedPatient` writes them from both submit paths; shared `applyPatientDefaults(p)` prefills the form from both the name-autocomplete pick and the Settings "start visit" path (guards deleted categories/types, refreshes points+pay preview); backup/restore round-trips the fields.

### 1.1 Migration

`npx supabase migration new saved_patient_defaults`, contents:

```sql
alter table saved_patients
  add column if not exists cat  text,
  add column if not exists type text,
  add column if not exists dur  int;

-- Backfill from each patient's most recent visit so the feature works
-- immediately, not only after the next visit is saved.
update saved_patients sp set
  cat  = (select v.cat  from visits v where v.user_id = sp.user_id and lower(v.name) = lower(sp.name) order by v.date desc, v.id desc limit 1),
  type = (select v.type from visits v where v.user_id = sp.user_id and lower(v.name) = lower(sp.name) order by v.date desc, v.id desc limit 1),
  dur  = (select v.dur  from visits v where v.user_id = sp.user_id and lower(v.name) = lower(sp.name) order by v.date desc, v.id desc limit 1);
```

Apply with `npx supabase db push`. Also append the three columns to the `saved_patients` line in CLAUDE.md's table list.

### 1.2 Code changes (index.html)

1. **`loadAllDataFromSupabase()`** (~line 1136): the `savedPatients` mapping currently keeps only `name, addr, coords`. Add `cat:r.cat||null, type:r.type||null, dur:r.dur||null`.
2. **`upsertSavedPatient(name,addr,coords)`** (~line 1694): extend signature to `(name,addr,coords,cat,type,dur)`; write the new fields in both the local `savedPatients` update and the `sb.from('saved_patients').upsert({...})` payload. Update BOTH call sites in `submitVisitForm()` (edit branch and insert branch) to pass the visit's `cat, type, dur`.
3. **`setupNameAutocomplete()`** (~line 1704), in the dropdown click handler after setting `f-name`/`f-addr`: if `p.cat` / `p.type` / `p.dur` are non-null, set `f-cat` / `f-type` / `f-dur` — but ONLY if a matching `<option>` exists in the select (custom categories can be deleted in Settings; guard with `[...sel.options].some(o=>o.value===p.cat)`). Then call `updatePtsPreview()`.

### 1.3 Verify

- [ ] Add a visit for a new patient with a non-default category/type/duration → reopen add panel, type 2 letters of the name, pick them → all fields fill, points preview updates.
- [ ] A pre-existing saved patient (backfilled) also fills cat/type/dur.
- [ ] Deleting a custom category in Settings, then picking a patient saved with it, does not blank/crash the form (falls back to whatever was selected).
- [ ] Brace/paren/div validation passes; hard refresh + re-login loads data.

---

## Slice 2 — Points forecast + share-sheet export

**Goal:** the weekly number becomes guidance, and the reimbursement summary goes straight to Messages/email with one tap.

**Status:** [x] implemented (pending deploy) — forecast line `#week-forecast` under the weekly bar (hidden when target met, guards divide-by-zero, "N routine visits or M <top category>"); `exportSummary()` now uses `navigator.share` on mobile with `AbortError` handling and a `downloadSummaryTxt()` desktop fallback.

### 2.1 Points forecast

In **`renderStats()`** (~line 2620), `remain` is already computed. Below the weekly progress bar (`weekly-bar-lbl` area in the HTML), add a one-line forecast element, e.g. id `weekly-forecast`:

- If `remain <= 0`: hide it (the 🎉 state already exists).
- Else: `"${remain.toFixed(2)} to go — about ${Math.ceil(remain/routinePts)} routine visits"` where `routinePts = catPoints[<routine key>]`. Look up the actual key in `DEFAULT_POINTS` (do not guess the key string — read the constant). If a higher-value category exists, append `" or ${Math.ceil(remain/maxPts)} ${maxLabel}"` using the highest-value entry in `catPoints`. Guard divide-by-zero (a user can set a category to 0).
- Style: muted, small, one line. No new panel.

### 2.2 Share-sheet export

In **`exportSummary()`** (~line 2764): after building `txt`, if `navigator.share` exists, `try { await navigator.share({title:'Roundly — Daily Summary', text: txt}); return; } catch(e) { /* user cancelled → fall through is WRONG; only fall through on share failure, not AbortError */ }`. Distinguish `e.name==='AbortError'` (user cancelled — do nothing) from real failure (fall back to the existing `.txt` download path). Desktop (no `navigator.share`) keeps the download unchanged.

### 2.3 Verify

- [ ] Forecast line shows sensible counts mid-week; disappears when target met; no NaN/Infinity when a category is 0 pts.
- [ ] On a phone: Export opens the iOS/Android share sheet with the summary text; cancelling does NOT also download a file; desktop still downloads `.txt`.
- [ ] Brace/paren/div validation.

---

## Slice 3 — "Next stop" hero card on today's Visits list

**Goal:** open the app between houses → next stop is unmissable, with big Navigate + Done. No new tab (5 bottom-nav tabs is the ceiling — do NOT add a 6th).

**Status:** [ ] not started

### 3.1 Implementation

In **`renderList()`** (~line 2571):

**Status:** [x] shipped — `.next-stop-hero` prepended in `renderList` on today only; next = first pending in `routeVisits(todayStr())`; big Navigate + Mark-done reuse `data-action` delegation; `.route-complete` strip (done/total · pts · pay) when nothing pending; the visit still appears in the list below. Accent-gradient card, 52px buttons, translucent chips.

- Condition: `listSelectedDate === todayStr()` AND there is at least one `pending` visit today.
- Next stop = first visit with `status==='pending'` in **`routeVisits(todayStr())`** order (driving order — NOT `getSorted()` display order).
- Prepend a hero card above the normal list: patient name (large), address, time chip, leg distance via `legInfoFor(v)`, and two large buttons — **🧭 Navigate** (primary, `data-action="nav"`) and **✅ Done** (`data-action="done"`). Reuse the existing `data-action`/`data-id` delegation (`handleListClick`) — no new handlers.
- The hero visit still appears in the list below (do not remove it — the list is the full-day record). Marking Done re-renders; the hero advances to the next pending stop; when none remain, show a small "🎉 Route complete — X pts today" strip instead.
- CSS: new `.next-stop-hero` block near the `.visit-card` styles; buttons min-height 52px; respects light/dark via existing CSS variables (`var(--accent)` etc.).

### 3.2 Verify

- [ ] Today with pending visits → hero shows the correct next stop per driving order (test both time-order and an optimized day).
- [ ] Done on the hero advances it; last one shows the complete strip; other dates and empty days show no hero.
- [ ] Both light and dark mode look right; phone-width (<481px) layout doesn't overflow.
- [ ] Brace/paren/div validation.

---

## Slice 4 — Swipe-to-complete, touch targets, delete-undo

**Goal:** in-car ergonomics — fewer, bigger, safer taps.

**Status:** [ ] not started

### 4.1 Swipe right = Done toggle

Delegated `touchstart`/`touchmove`/`touchend` on `#visit-list-container`, targeting `.visit-card`:

- Horizontal intent threshold: act only if `|dx| > 60px` AND `|dx| > 2*|dy|` — must never fight vertical scroll.
- During move (once intent established): `transform: translateX(...)` capped ~80px, with a ✅ affordance revealed behind the card.
- On release past threshold: call the existing `markDone(id)` (it's already a toggle). Snap back otherwise.
- Right-swipe ONLY. No left-swipe action drawer — out of scope, keep it simple.

### 4.2 Touch targets

Audit `.card-action-btn` and bottom-nav buttons to min-height ≥ 44px at phone width. CSS only.

### 4.3 Delete-undo (replace `confirm()`)

**`deleteVisit(id)`** (~line 2151) currently uses a blocking `confirm()`. Replace with:

- Delete immediately (local removal + DB delete + the existing same-day renumber loop), then show a toast **"🗑️ Deleted [name] — Undo"** for ~6s (extend `showToast` to support an action button, or add a `showUndoToast`).
- Undo re-INSERTS the visit via the same insert path as `submitVisitForm()`'s insert branch (new row id is fine and expected), restoring `name/addr/date/time/dur/type/cat/notes/status/coords`, then renumbers and re-renders.
- Note: `deleteFromEditPanel()` awaits `deleteVisit`'s boolean — it no longer needs a confirm result; it should just close the panel after calling delete. Update it.

### 4.4 Verify

- [ ] On a real phone: vertical scrolling through a long list never triggers swipe; deliberate right-swipe marks done; swiping a done card undoes it.
- [ ] Delete → Undo restores the visit fully (check pin reappears on map, points restored, `num` order sane); letting the toast expire leaves it deleted after a hard refresh.
- [ ] Delete from the edit panel still works and closes the panel.
- [ ] Brace/paren/div validation.

---

## GATE — two questions for Bre (answer before Slice 5)

1. **What does her schedule actually look like each morning?** (agency EMR screen? text? email? paper?) → decides whether Slice 5's paste-parser matches reality, or should target iOS Live-Text-from-photo text instead, or should be dropped.
2. **Does her agency accept the app's OSRM road mileage for reimbursement as-is?** → if yes, no further mileage work is needed, ever (confirms cutting the GPS recorder was right). If no, find out what evidence they need before designing anything.

Record the answers here:
- Schedule format: _(unanswered)_
- OSRM mileage accepted: _(unanswered)_

---

## Slice 5 — Bulk paste import (CONDITIONAL on gate Q1)

**Goal:** paste the day's list → review parsed visits → confirm → all inserted. Kills per-visit typing on heavy days.

**Status:** [ ] blocked on gate

### 5.1 Implementation sketch (adjust to the real input format from the gate)

- New "📋 Paste day's list" button inside the add panel (`openAddPanel` area), opening a textarea panel.
- Parser: split lines; per line extract a time (`\b\d{1,2}(:\d{2})?\s*(am|pm)?\b` heuristics), then split remainder on comma/dash/tab into name + address. Unparseable lines pass through as name-only rows.
- **Mandatory review table** before any insert: editable name/address/time/category per row, per-row remove. Never blind-insert (real patient data).
- On confirm: geocode each row **sequentially with ~1s spacing** via existing `geocodeSearch()` — Photon is a free service; do NOT fire N parallel requests. Rows whose name matches a saved patient skip geocoding and reuse stored coords + cat/type/dur (Slice 1 data).
- Insert through the same logic as `submitVisitForm()`'s insert branch (respecting the `num = count+1` sequence across the batch, incrementing locally as the batch grows), then `upsertSavedPatient` for each, one `renderAll()` at the end.
- Show progress ("Adding 3 of 6…") since geocoding is throttled.

### 5.2 Verify

- [ ] Paste a 6-line list in the real-world format → review table correct → confirm → 6 visits with pins, correct `num` sequence, correct points.
- [ ] A line with a garbage address inserts without a pin and shows the existing geo warning pattern.
- [ ] Saved-patient rows fill cat/type/dur automatically.
- [ ] Brace/paren/div validation.

---

## Slice 6 — Foreground proximity "mark done" prompt

**Goal:** open the app while standing at a patient's house → one-tap confirm instead of find-the-card. Foreground only — NO `watchPosition`, NO tracking session.

**Status:** [ ] not started

### 6.1 Implementation

- Trigger points: app becomes visible (`visibilitychange` → visible) or Visits/Map view opened, AND `listSelectedDate === todayStr()` AND at least one pending visit has `coords`.
- One `navigator.geolocation.getCurrentPosition()` call (timeout ~5s, `maximumAge` ~60s). All failures (denied, timeout, unavailable) are silent no-ops — this feature must never nag.
- If the fix is within **150m** (`haversine()`) of exactly one pending visit → show a dismissible banner above the list: "📍 At [name]? — ✅ Mark done / ✕". Multiple matches within range → nearest one. Reuse `markDone(id)`.
- Throttle: once a visit's prompt is dismissed, don't re-prompt for that visit for 30 min (in-memory or `loadLocalPref`).
- First-run: browsers show their own permission prompt on first `getCurrentPosition` — acceptable; if denied, feature stays silent forever after (check `permissions.query` where available to avoid re-prompting).

### 6.2 Verify

- [ ] With location granted and standing "near" a pending visit (test by setting a visit's address to your current location): banner appears, Done works, dismiss suppresses re-prompt.
- [ ] With location denied: zero prompts, zero errors in console, app fully functional.
- [ ] No prompts on past/future dates or when all visits are done.
- [ ] Brace/paren/div validation.

---

## Slice 7 — Offline: app-shell service worker + status-write queue

**Goal:** the app opens and Done/Skip work in rural dead zones; changes sync when signal returns. Deliberately NOT full offline CRUD — add/edit/delete still require signal (offline inserts would need a client-generated-id refactor; out of scope).

**Status:** [ ] not started

### 7.1 Service worker (`sw.js`, new file — the one allowed exception to single-file)

- Register from index.html after load: `navigator.serviceWorker.register('/sw.js')`.
- **`index.html` / navigation requests: NETWORK-FIRST, cache fallback.** This is critical — cache-first would pin users to a stale app forever since Netlify deploys new HTML at the same URL. Update the cached copy on every successful network fetch.
- Leaflet JS/CSS and the Supabase client lib (CDN): stale-while-revalidate.
- Map tiles: do NOT cache (unbounded storage); the map simply doesn't load offline — acceptable.
- Bump a cache version constant in `sw.js` whenever its caching logic changes.

### 7.2 Status-write queue (index.html)

- New helper `queueStatusWrite(visitId, status)` → localStorage array `roundlyWriteQueue_<userId>` of `{id, status, ts}` (later entry for the same id wins).
- **`markDone()` / `markSkip()`** (~line 2135): local state + `renderAll()` already happen optimistically before the await — keep that. If the Supabase update errors OR `!navigator.onLine`: enqueue instead of just toasting; toast becomes "Saved offline — will sync".
- Flush: on `window 'online'` event and on app load after `loadAllDataFromSupabase()` — replay queued updates (`.eq('id',…).eq('user_id',…)` as today), remove entries on success, keep on failure. Flush BEFORE applying loaded data would be ideal, but simpler and fine: flush after load, then re-apply queued statuses to the in-memory `visits` so the UI reflects them.
- Scope guard: ONLY `status` updates go through the queue. Do not extend it to inserts/edits/deletes.

### 7.3 Verify

- [ ] Airplane mode → app opens (after one prior online visit), today's list renders, Done/Skip work and toast "Saved offline".
- [ ] Signal back → queue flushes (verify rows in Supabase), no duplicate/lost statuses, queue empties in localStorage.
- [ ] Deploy a trivial HTML change → phone gets it on next online open (network-first proof — this is the most important check in the slice).
- [ ] Two-device check: statuses queued on the phone don't clobber newer changes made online from the laptop beyond last-write-wins expectations.
- [ ] Brace/paren/div validation.

---

## Sequencing summary

| # | Slice | Size | Ships alone? |
|---|-------|------|--------------|
| 1 | Saved-patient defaults (migration + autocomplete) | S | ✅ |
| 2 | Points forecast + share-sheet export | S | ✅ |
| 3 | Next-stop hero card | M | ✅ |
| 4 | Swipe / targets / delete-undo | M | ✅ |
| — | GATE: Bre's two questions | — | — |
| 5 | Bulk paste import | M | ✅ (if gate passes) |
| 6 | Proximity done prompt | S | ✅ |
| 7 | Service worker + status queue | L | ✅ |

After each slice: verification checklist → commit (one slice per commit, message `Slice N: <name>`) → push → sanity-check the live Netlify deploy on a phone → tick the slice checkbox in this file. Get Bre's reaction after Slices 2–4 land; reorder the remainder if her feedback says so.

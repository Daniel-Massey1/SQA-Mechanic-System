# SQA Mechanic System: Assessment 2 Working Notes

> **Purpose:** a single reference for finishing Assessment 2. It records what is built, which requirements are met, the requirement changes to make, the defects found, and what is left.
> **Readers:** the team, and any AI assistant given this file as context.
> **Last updated:** 2026-10-08 (after commit `bc4b508`; requirement wording updated by the team, see section 3).
> **Status legend:** ✅ done · ⚠️ partial · ❌ missing · ❓ needs testing · 📝 requirement wording was changed (see section 3)

---

## 1. Project snapshot

- **What it is:** a workshop portal for a small mechanic business. Customers book services and see vehicle history, mechanics approve bookings and complete checklists and diagnostics, and managers see a quality dashboard.
- **Stack:** Node.js + Express backend (`backend/`), SQLite via `better-sqlite3` (`backend/db/portal.db`), plain HTML/CSS/JS frontend (`frontend/`). Everything runs on `http://localhost:3001`.
- **Run:** `cd backend && npm install && npm start`
- **Tests:** `cd backend && node --test` (10 tests, all passing at last run).
- **Demo accounts** (password `123`): `customer1`, `customer2`, `mechanic1`, `manager1`.
- **Roles:** `customer`, `mechanic`, `manager`. Every API route checks the role on the server using signed bearer tokens.
- **Email:** mocked. Every email is written to the `notifications` table (the outbox) and "sent" by logging `[MOCK EMAIL]` to the console.

### Key files

| Area | File |
|---|---|
| Schema, migrations, seed data | `backend/db/db.js` |
| Auth (tokens, role checks, denial logging) | `backend/auth.js`, `backend/routes/auth.js` |
| Customer booking and cancellation | `backend/routes/bookings.js` |
| Vehicles and vehicle history | `backend/routes/vehicles.js` |
| Mechanic portal (approvals, checklists, diagnostics) | `backend/routes/mechanics.js` |
| Manager dashboard, accounts, checklist editor | `backend/routes/manager.js` |
| Email outbox and retries | `backend/services/notifications.js` |
| WOF and service reminders (scheduler) | `backend/services/reminders.js` |
| Versioned checklist templates and shared service types | `backend/services/checklists.js` |
| Frontend | `frontend/index.html`, `frontend/app.js`, `frontend/style.css` |

---

## 2. Requirement status

### Functional: customer

| ID | Requirement (short) | Status | Notes / evidence |
|---|---|---|---|
| FR01 | Booking creates a **pending** record and shows a reference within 3s | ✅ 📝 | Confirmed when a mechanic approves it. Wording updated (C01). |
| FR02 | A taken slot is rejected with a pop-up and no duplicate record | ✅ | 409 response plus `alert`. Unique DB indexes (`idx_unique_active_slot`) stop double bookings even when two requests arrive together. |
| FR03 | Cancelling within 24h (**inclusive**) of the booking time is refused with an error | ✅ 📝 | `isWithinCancellationWindow()` in `bookings.js` (Sam, `f39226d`). Wording updated (C07). |
| FR04 | Cancelling more than 24h ahead sets status `cancelled`, removes it from upcoming bookings and the mechanic's schedule, and emails the **workshop** | ✅ 📝 | Fixed in `7dfd6c8`; the record is kept and shown under the customer's past bookings. Wording updated (C08). |
| FR05 | WOF reminder 14 days before expiry | ✅ | Fixed in `1b4d47b`: queued at 8:00am NZ time, sent within minutes, no duplicates. Service reminders are covered by AC07. **Team decision: FR05 wording kept as written.** |
| FR06 | Vehicle history: issues, fixes and future issues, newest first | ✅ | `GET /api/vehicles/:id/history`. "Future issues" are entries with status `flagged_for_next_visit`. |

### Functional: mechanic

| ID | Requirement (short) | Status | Notes / evidence |
|---|---|---|---|
| FR07 | "Approve"/"Deny" sets status `confirmed`/`denied` and notifies the customer within 5 minutes | ✅ 📝 | Fixed in `7dfd6c8`. The email is sent immediately and the outcome shows on the customer's booking card. Wording updated (C02). |
| FR08 | Diagnostic entry (vehicle ID, fault, severity, status) stored as a new entry on the right vehicle | ✅ | `POST /api/mechanics/diagnostics`. Unknown vehicle returns 404 "Vehicle not found". |
| FR09 | Checklist for the service type, from a configurable table | ✅ | Loads the latest version from `checklists`. Managers can edit it since `1a5f413`. |
| FR10 | All items ticked: job marked "checklist compliant" and recorded | ✅ | Jobs are saved with `checklist_compliant = 1`, status `Checklist Compliant`. **But** a job cannot be saved unless all items are ticked, so FR15 is always 100% (see R03). |

### Functional: manager

| ID | Requirement (short) | Status | Notes / evidence |
|---|---|---|---|
| FR11 | Total completed jobs **for a date range** | ⚠️ | The count works; **there is no date range filter** (R01). Date range now defined in the requirements (C06). |
| FR12 | Selecting a completed job shows mechanic, details, duration, checklist | ✅ | The job details pop-up now also shows the checklist **version** the job used. |
| FR13 | Average repair time **in hours** for a date range | ⚠️ | Shown in minutes, has no date range, and has a **timezone bug** (D10). Fix in R02. |
| FR14 | Acceptance % = approved / total for a date range | ⚠️ | The formula works; no date range. |
| FR15 | Checklist compliance % = compliant / completed for a date range | ⚠️ | Always 100% by design (R03); no date range. |
| FR16 | Number of incomplete checklists for a date range | ⚠️ | Currently counts *confirmed bookings not yet completed*, not incomplete checklists (R03); no date range. |
| FR17 | Filter metrics by mechanic | ✅ ⚠️ | Works. The incomplete count filters on who **approved** the booking (`decided_by`), because jobs are not assigned to mechanics (D15). |

### Non-functional

| ID | Requirement (short) | Status | Notes / evidence |
|---|---|---|---|
| NFR01 | Role-based access; deny and **log** other attempts | ✅ | `denyAccess()` in `backend/auth.js` logs `[ACCESS DENIED]` with method, path, username, role and reason. Tests are in `auth.test.js`. |
| NFR02 | Reminder failure: retry up to 3 times over 24h, no data lost or changed | ✅ | Outbox retries every 8h; status becomes `failed` after 1 attempt plus 3 retries. Email data is separate from booking and history data. `MOCK_EMAIL_FAILURE_RATE` simulates failures for demos. |
| NFR03 | 95% of vehicle history loads under 2s with 20 users | ❓ | Not measured yet; this is a Task 7 performance test. Possible improvement: index on `diagnostic_entries(vehicle_id)`. |
| NFR04 | First-time customer books in 3 or fewer steps | ⚠️ | The flow is exactly 3 steps (Vehicle, Service & Slot, Confirm), but a **new customer has no vehicle** and must leave the flow to add one (R04). |
| NFR05 | Manager edits a checklist template and it applies to new jobs with no code change or redeploy | ✅ | Built in `1a5f413`. Saves create a new version, new jobs use the latest at once, completed jobs keep theirs, and simultaneous edits get a 409 conflict. |
| NFR06 | Diagnostic entries never overwritten; edits stored as new entries referencing the original | ✅ | `PUT /diagnostics/:id` inserts a new row with `supersedes_entry_id`. Optional hardening: a DB trigger to block UPDATE/DELETE (R07). |

### Acceptance criteria

| ID | Status | Notes |
|---|---|---|
| AC01 Customer can submit a valid booking request | ✅ 📝 | Created as pending (C01). |
| AC02 Confirmation message displayed within 3s | ❓ 📝 | Reference is shown immediately; time it in Task 3. |
| AC03 Invalid booking rejected with reason | ✅ | Missing fields, bad date, past time, bad service type, someone else's vehicle. |
| AC04 Two customers, same slot: only one succeeds and the other is told it's taken | ✅ 📝 | DB unique index plus 409. Typo fixed ("created" → "already taken"). |
| AC05 Cancellation within 24h (inclusive) refused with reason | ✅ 📝 | (C07) |
| AC06 Cancellation **more than** 24h ahead: status `cancelled`, workshop emailed | ✅ 📝 | (C07, C08) |
| AC07 WOF **or service** reminder 14 days out | ✅ | Both, from `1b4d47b`. |
| AC08 Reminder sent within 30 min of the daily check | ✅ | Check at 08:00 NZ; outbox runs every minute. |
| AC09 Customer views their repair history | ✅ | |
| AC10 Mechanic views all history **searched by plate** | ⚠️ | Dropdown only; no search box (R05). |
| AC11 Under 20 users, 95% of history loads under 2s | ❓ | Same as NFR03. |
| AC12 Customer informed of approve/deny within 5 min | ✅ | `7dfd6c8`. |
| AC13 Decided request cannot change and leaves the dashboard | ✅ | Only `pending` bookings can be decided. |
| AC14 Entry linked only to the vehicle the mechanic selected | ✅ 📝 | Vehicle chosen from a list by ID (C03). |
| AC15 Entry for a vehicle ID that doesn't exist is rejected with a message | ✅ 📝 | 404 "Vehicle not found" (C03). |
| AC16 Entries never overwritten; edits stored as new references | ✅ | |
| AC17 Starting a job loads the matching checklist | ✅ | |
| AC18 Closing a checklist stores its **percentage** linked to the mechanic | ❌ | Only 100%-complete checklists can be saved; no % stored (R03). |
| AC19 Manager sees checklist completion and average time per mechanic | ⚠️ | Mechanic filter works; the time and compliance figures have the problems above. |
| AC20 Selecting a job shows mechanic, details, checklist completion | ✅ | |
| AC21 User only accesses records for their own cars | ✅ | Server-side checks on every customer route. |
| AC22 Manager/mechanic can access any repair record | ✅ | |

---

## 3. Requirement changes (document in Task 1 and Task 2)

Record each one in the RTM with a version note, e.g. *"FR01 v2: changed because…"*.
**Status:** ✅ Applied = wording updated in the requirements document · 📄 Write-up = goes in the A1 attributes section or the Task 1 scope write-up, not the requirement list · ⏳ Pending.

| # | Req | Original | Now | Justification | Status |
|---|---|---|---|---|---|
| C01 | FR01, AC01, AC02 | Submitting creates a **confirmed** booking; confirmation "sent" | Submitting creates a **pending** booking; a confirmation reference is **displayed** within 3s | The workshop controls its capacity, and FR07/AC12/AC13 only make sense if bookings need approval. | ✅ Applied |
| C02 | FR07 | Mechanic selects approve/deny; status "updated accordingly" | Mechanic selects "Approve"/"Deny"; status becomes `confirmed`/`denied` | Testable wording ("accordingly" can't be tested), and matches the booking lifecycle (pending, confirmed, completed / denied / cancelled). | ✅ Applied |
| C03 | AC14, AC15 | Entries linked by **number plate**; unknown plate rejected | Entry linked to the vehicle the mechanic **selected** (vehicle ID); unknown vehicle ID rejected | Matches FR08, which already says "vehicle ID". Choosing from a list stops wrong links in the first place. | ✅ Applied |
| C04 | A1 maintainability attribute | Template changes apply "immediately to **all jobs**" | "...to all **new** jobs" | Changing completed jobs would rewrite history and break the data integrity attribute and AC20. Matches NFR05. | 📄 Write-up (A1 quality attributes) |
| C05 | FR13 | Average repair time (no start point) | Average time from **booked slot to completion**, in hours | There is no "start job" step; the booked slot is the agreed start time. | ✅ Applied |
| C06 | Manager side (FR11–FR16) | "Selected date range" undefined | Defined once: from/to date on the **job completion date**, defaulting to the last 30 days | Makes the date-range requirements testable. **Note:** FR14 counts booking requests (no completion date), so R01 will filter FR14 by the **booking decision date**. Record this in the RTM. | ✅ Applied |
| C07 | FR03, AC05, AC06 | Within 24h refused; "24 hours **or more**" can cancel | Within 24h (**inclusive**) refused; **more than** 24h can cancel | Removes the overlap between AC05 and AC06 at exactly 24h. Code: Sam (`f39226d`). | ✅ Applied |
| C08 | FR04, AC06 | Booking "removed"; "notify **the mechanic**" | Status becomes `cancelled`; removed from upcoming bookings and the mechanic's schedule; the **workshop** is emailed | "Removed" caused the hard-delete defect (D01). No mechanic is assigned at booking time. | ✅ Applied |
| C09 | A1 scope | "Real accounts / sign up" and "proper security" out of scope; mock login planned | **Built:** sign-up, hashed passwords, signed expiring tokens, rate limiting, managers creating mechanics | Mock login made NFR01 meaningless (any request could claim to be any user). | 📄 Write-up (Task 1 scope changes) |
| C10 | A1 plan: "final working email system" | Real email delivery | **Stays mocked** through the outbox | Real email is out of scope in A1. The outbox records every message, attempt and failure, so it is testable without a provider. | 📄 Write-up (Task 1 scope changes) |
| C11 | FR16, AC18 | "Jobs with incomplete checklists" / "percentage is stored" | Kept as written; to be met by building R03 (jobs can be closed with unticked items) | Without R03, FR15 is always 100% and FR16 has nothing real to count. | ⏳ Pending R03 |
| — | FR05 | — | **Kept as written** (team decision) | Implementation already runs at 8:00am NZ time and sends within 30 minutes. AC07 covers service reminders. | ✅ No change |
| — | AC04 | "inform the customer the timeslot is created" | "...is already taken" | Typo fix. | ✅ Applied |
| — | (A1 limitations) | "Not yet added: login saves when reloading page" | Line removed | It is implemented: the session is saved and re-checked with `/api/auth/session`. | ✅ Applied |

### Inconsistencies in the A1 requirements (useful for Task 2)

- FR08 says **vehicle ID**; AC14/AC15 say **number plate** (resolved by C03).
- The A1 maintainability attribute says **all jobs**; NFR05 says **all new jobs** (resolved by C04).
- AC05 ("within 24 hours") and AC06 ("24 hours or more") overlap at exactly 24h (resolved by C07).
- FR04 says notify "the mechanic", but no mechanic is assigned at booking time (resolved by C08).
- A1 "Current limitations" listed persistent login as not added; it **is** implemented (session stored and re-checked with `/api/auth/session`).
- FR10 allows only fully ticked jobs to be "compliant", while AC18 expects a stored **percentage**, so partial checklists must exist (R03).

---

## 4. Remaining work (priority order)

| # | Item | Reqs | Size | Notes |
|---|---|---|---|---|
| R01 | Date-range filter on the manager dashboard (from/to, default last 30 days) for all metrics and the jobs list | FR11, FR13–FR16 | Medium | Use C06's definition; FR14 filters by booking decision date. |
| R02 | Fix average repair time: hours, same timezone for both timestamps, and no completing before the booked slot | FR13, AC19 | Small | Fixes D10 and D16. Store `completed_at` the same way as `slot_start`, or convert both before subtracting. |
| R03 | Mechanics can close a job with unticked items: status "Checklist Incomplete", completion % and ticked items stored | FR10, FR15, FR16, AC18 | Medium | Store the ticked items per job so job details show what was actually ticked, not the full template. |
| R04 | Add a vehicle inside booking step 1 so a first-time customer still books in 3 steps | NFR04 | Small | Frontend only; reuse the add-vehicle form and `POST /api/vehicles`. |
| R05 | Plate search box for mechanic/manager vehicle history | AC10 | Small | Frontend only; filter the already-loaded vehicle list. |
| R06 | Consistent error handling (frontend `fetch` without try/catch, some routes with no DB error handling) | A1 limitations | Small–Medium | E.g. `loadHistory`, `loadHistoryVehicleOptions`, `decideBooking`. |
| R07 | Optional: SQLite trigger blocking UPDATE/DELETE on `diagnostic_entries`; record which mechanic made each entry | NFR06, AC16 | Small | Moves the integrity rule from the app into the database. |
| R08 | Optional: index on `diagnostic_entries(vehicle_id)` before performance testing | NFR03 | Tiny | |
| R09 | Login rate limit should count only failed attempts | NFR01 | Tiny | Fixes D17; do this before the demo. |

### Non-feature work still to do (later tasks)

- **Task 3/4:** automated API tests. `server.js` calls `listen()` on load, so it needs to export `app` before routes can be tested in-process.
- **Task 4:** restore the saved reminder tests (see section 7).
- **Task 5:** add `"test": "node --test"` to `backend/package.json` and a GitHub Actions workflow (install, then test).
- **Task 7:** performance (NFR03/AC11), security (NFR01, role bypass attempts), reliability (NFR02 with `MOCK_EMAIL_FAILURE_RATE`).
- **README:** check it is up to date before submission.

---

## 5. Defect register (draft for Task 6)

**Suggested categories.**
- **Severity:** Critical (data loss/security), High (requirement broken), Medium (wrong behaviour, workaround exists), Low (cosmetic/minor).
- **Priority:** P1 fix now, P2 fix before release, P3 nice to have.
- **Status:** Open, In Progress, Fixed, Verified, Deferred.

| ID | Defect | Severity | Root cause | Fix / status | Commit |
|---|---|---|---|---|---|
| D01 | Cancelled bookings were **hard-deleted**, so the audit trail was lost and metrics were skewed | High | AI-generated code followed the original FR04 wording ("removed") literally; the schema's `cancelled` status was never used | Status becomes `cancelled` with `cancelled_at`; record kept. **Fixed.** | `7dfd6c8` |
| D02 | Customers were never told when a booking was approved/denied | High | Feature missed: the decision route only updated the status | Email via outbox plus notice on the booking card. **Fixed.** | `7dfd6c8` |
| D03 | WOF reminder checked the **UTC** date, a day behind NZ every morning, so reminders could be missed | High | `new Date().toISOString().slice(0,10)` returns the UTC date; NZ is UTC+12/+13 | Uses the workshop timezone (`Intl.DateTimeFormat`, `Pacific/Auckland`). **Fixed.** | `1b4d47b` |
| D04 | Reminders were sent **again on every server restart** | Medium | No record of sent reminders; the check ran on startup | Each reminder has a unique key (type, vehicle, due date); check runs once per day after 8am. **Fixed.** | `1b4d47b` |
| D05 | Reminder retries happened **instantly**, not over 24h (NFR02) | Medium | Retry was a tight loop with no delay or saved state | Outbox with `next_attempt_at`; retry every 8h, then marked `failed`. **Fixed.** | `1b4d47b` |
| D06 | A random 15% simulated failure made reminder behaviour unpredictable and untestable | Low | Mock email used `Math.random()` with no way to turn it off | Off by default; `MOCK_EMAIL_FAILURE_RATE` turns it on. **Fixed.** | `1b4d47b` |
| D07 | Mechanic checklist lookup returned the **first** row for a service type (it would return the oldest version once versions existed) | Medium (latent) | Query had no ordering or version | `getLatestChecklist()` orders by version. **Fixed.** | `1a5f413` |
| D08 | Editing a checklist template would have **changed the checklist shown on completed jobs** | High (design) | Jobs pointed to a template that could be edited in place | Templates are versioned; jobs keep their `checklist_id`. **Fixed.** | `1a5f413` |
| D09 | Cancelling at **exactly 24h** was allowed, contradicting AC05 | Medium | `< 24` comparison; AC05/AC06 overlap at the boundary | Inclusive check `<= 24h`; boundary unit tests added. **Fixed (Sam).** | `f39226d` |
| D10 | Average repair time is **wrong or negative** | High | `completed_at` is stored as UTC (`datetime('now')`) while `slot_start` is local time, so durations are off by 12–13h | **Open.** R02. | |
| D11 | Checklist compliance is **always 100%**; FR15/FR16 don't measure anything | Medium | Jobs can only be saved when every item is ticked | **Open.** R03. | |
| D12 | A first-time customer cannot book in 3 steps (no vehicle yet) | Low | Adding a vehicle is on a separate page | **Open.** R04. | |
| D13 | Some frontend screens break or hang when a request fails | Medium | `fetch` calls with no try/catch or `res.ok` check (AI-generated code assumed success) | **Open.** R06. | |
| D14 | Auth tests run against the real `portal.db` | Low | Tests don't set `DB_PATH` | **Open.** Point at a temporary DB as `reminders.test.js` does. | |
| D15 | Mechanic filter on "incomplete" uses the **approver**, not the mechanic doing the work | Low | Jobs are not assigned to mechanics; `decided_by` used as a stand-in | **Open / document.** | |
| D16 | A mechanic can complete a job **before its booked slot**, giving a **negative** repair duration (seen: −7,970 min for a job completed 5 days early) | High | No check that the slot has started before a checklist is saved. FR13 measures from the booked slot, so finishing early always gives a negative time. Combined with D10, which added about 13h of the error | **Open.** Block completing before the slot starts, or count early finishes as zero. Fix with R02. | |
| D17 | Login rate limit counts **successful** logins as well as failed ones, so switching roles about 10 times in 15 min locks you out (429) | Medium (demo risk) | `loginLimiter` (10 requests per 15 min per IP) counts every request to `/api/auth/login` | **Open.** Count only failed attempts, or raise the limit for local use. Restarting the server clears it. | |

**Good candidates for the 3 root cause analyses:** D03 (timezone), D01 (literal requirement, then data loss), D08 (template edits rewriting history). D10 is another timezone defect with the same root cause as D03, which makes a strong "lesson learned and prevention" point: store and compare all timestamps the same way.

---

## 5a. Full feature walkthrough (2026-10-08)

The whole system was exercised over HTTP against a fresh throwaway database with a temporary script (not committed).

- **Result: 97 of 98 checks passed.** Areas covered:
  - platform, auth and sign-up;
  - customer vehicles, booking (including two customers racing for one slot) and cancellation;
  - mechanic approvals, checklists and jobs, diagnostics and history;
  - manager dashboard, job details, accounts and the checklist editor;
  - role blocking on every protected route;
  - rate limiting.
- **Also verified:**
  - 20 denied attempts logged with username, role, path and reason (NFR01);
  - every booking email recorded as `sent` in the outbox;
  - reminders: none at 07:59, WOF and service reminders at 08:00, no duplicates at 09:00;
  - failing email retried at 0, 8, 16 and 24h, then `failed`;
  - all 96 frontend element IDs exist in `index.html`;
  - no errors in the server log.
- **Failed:** average repair time was **negative** (−7,970 min). Cause: D16 (job completed before its slot) plus D10 (UTC vs local time).
- **Observed:** checklist compliance showed **33%** (1 completed ÷ (1 completed + 2 confirmed, unfinished)). This confirms D11.
- **Observed:** after 6 successful logins, a 429 came back on the 5th wrong password. This confirms D17.
- **Not covered:** clicking through the UI in a browser (layout, buttons). Do a manual click-through as each role before the demo.

---

## 6. Design decisions (what to say if asked)

- **Email outbox** (`notifications` table): every email is saved before it is sent. That gives retries (NFR02), an audit trail, and test evidence, and a failed email never fails the user's action.
- **Reminders** are queued once per day at the first scheduler tick after 08:00 workshop time. Known limitation: if the server is off on the exact "14 days before" day, that reminder is not sent later.
- **Checklist versioning:** editing saves a new version and never changes the old one. The manager sees a single "Save". Mechanics finish an in-progress job on the version they loaded. Simultaneous manager edits return 409 instead of silently overwriting.
- **Cancellation** is a status change, never a delete, so records stay for auditing and metrics.
- **Double booking** is blocked by DB unique indexes, not just an app check, so it holds when requests arrive at the same moment.
- **Diagnostics** are append-only (`supersedes_entry_id`), as with checklists.

---

## 7. Testing notes

- **Current automated tests (10, all passing):**
  - `backend/auth.test.js`: 5 tests (auth and access).
  - `backend/security.test.js`: 2 tests (password hashing, rate limiting).
  - `backend/routes/bookings.test.js`: 3 tests (24h boundary, Sam).
- **Saved for later: `git stash@{0}`.** Holds `backend/reminders.test.js` (7 tests: NZ date, 8am timing, no duplicates, retry timing, retry success, sender crash) and an `npm test` script.
  - ⚠️ The stash also holds **older versions** of other files. Restore **only** the test file: `git checkout "stash@{0}^3" -- backend/reminders.test.js`. Then add `"test": "node --test"` to `backend/package.json` by hand.
- **Manual verification so far:** each feature was checked by running the server against a **throwaway copy** of the database (`DB_PATH=... PORT=3099 node server.js`) and calling the API with a script. Checked so far:
  - cancel status and slot freed;
  - decision emails;
  - reminders sent, with no duplicates after restart;
  - invalid service dates rejected;
  - checklist version saving, validation, 409 conflicts, and old jobs keeping their version.

  These can become formal test cases in Task 3.
- **Test case ideas (positive / negative / boundary):**
  - booking: past time, taken slot, someone else's vehicle;
  - cancellation: 23h, exactly 24h, 25h, denied booking, already cancelled;
  - checklist editor: 0 items, 31 items, 2-character item, duplicate in different case, stale version gives 409, customer gets 403;
  - reminders: 07:59 vs 08:00 NZ, 13/14/15 days out;
  - access: customer requests another customer's vehicle history (403 and logged).

---

## 8. AI-assisted development notes (Task 9 evidence)

Issues found in AI-generated code during this phase, and how they were caught:

- Requirements implemented **literally without judgement**: hard delete on cancellation (D01).
- **Timezone assumptions**: `toISOString()` for "today" (D03), and the UTC/local mismatch in durations (D10).
- **Missing failure handling**: retries with no delay (D05), `fetch` assuming success (D13).
- **Latent bugs that only appear as features grow**: the checklist lookup returning the first row (D07).
- **Unfinished or outdated comments**, e.g. the `GET /api/manager/dashboard` doc comment in `manager.js` lists "Summary cards:" followed by empty bullets, and the `db.js` header still calls `checklists`/`jobs` "stub tables".
- **How outputs were reviewed:**
  - read every diff before committing;
  - split one large AI change into two focused commits (cancellation + decisions, then reminders);
  - ran each change against a throwaway database;
  - rejected over-scoped suggestions (e.g. letting managers create new service types, deferred to future work).

---

## 9. Commit history so far (Task 11 evidence)

| Commit | Author | Summary |
|---|---|---|
| `7dfd6c8` | Daniel | Cancelled bookings kept as a status; customers notified of approve/deny; email outbox |
| `1b4d47b` | Daniel | Service reminders; WOF reminder fixes (8am NZ, no duplicates, retries over 24h); README |
| `f39226d` | Sam | 24h cancellation boundary made inclusive, with unit tests |
| `1a5f413` | Daniel | Manager checklist template editor with versioning and validation |

---

## 10. Residual risks (for the release decision in Task 8)

- Manager metrics are unreliable until R01–R03 and D10 are fixed. This is the biggest risk to the "quality dashboard" goal.
- Email is mocked, so delivery to real inboxes is unverified.
- The rate limiter and scheduler run inside a single process, so they would not work correctly across multiple servers.
- Performance (NFR03) has not been measured.
- Only a few automated tests cover routes; most behaviour has been checked by hand only.

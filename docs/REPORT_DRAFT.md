# Assessment 2: Report Draft (plans and current evidence)

> **Status:** working draft, updated 2026-10-08 after the manager dashboard bundle (`b75c42a`). Some feature work remains (see `PROJECT_NOTES.md` section 4: R04–R09), so results, counts and the RTM may still change. Re-run the test cases after the remaining features are built.
> **Readers:** the team, and any AI assistant helping write the final report.
> **Related:** `PROJECT_NOTES.md` has the requirement status (section 2), requirement changes C01–C11 (section 3), remaining work R01–R09 (section 4) and the defect register D01–D17 (section 5).

Covers drafts for **Task 2** (RTM), **Task 3** (test cases and results), **Task 4** (automation plan), **Task 6** (defect lifecycle and RCA), **Task 7** (risk-based quality testing plan) and **Task 11** (contribution evidence).
Not drafted yet, because the numbers depend on finishing the features: Task 5 (CI), Task 8 (metrics and release decision), Task 10 (recommendations), Task 12 (slides).

---

## Task 2: Requirements Traceability Matrix (draft)

**Status key:** ✅ Verified (test passed) · ⚠️ Partial · ❌ Not implemented · ⏳ Not yet verified

| Req | Implemented by | Test cases | Result | Defects | Status |
|---|---|---|---|---|---|
| FR01 | `POST /api/bookings` (pending + reference), booking steps 1–3 | TC06 | Pass | — | ✅ |
| FR02 | Taken-slot check plus unique DB index `idx_unique_active_slot` | TC07, TC08 | Pass | — | ✅ |
| FR03 | `isWithinCancellationWindow()` (inclusive 24h) | TC10, unit tests `bookings.test.js` | Pass | D09 (fixed) | ✅ |
| FR04 | `POST /api/bookings/:id/cancel` sets status `cancelled`, emails workshop | TC11, TC12 | Pass | D01 (fixed) | ✅ |
| FR05 | `services/reminders.js` daily 08:00 NZ check + outbox | TC25 | Pass | D03, D04, D06 (fixed) | ✅ |
| FR06 | `GET /api/vehicles/:id/history` newest first | TC19 | Pass | — | ✅ |
| FR07 | `POST /api/mechanics/bookings/:id/decision` + email | TC13 | Pass | D02 (fixed) | ✅ |
| FR08 | `POST /api/mechanics/diagnostics` | TC17 | Pass | — | ✅ |
| FR09 | `GET /api/mechanics/checklists/:serviceType` (latest version) | TC15 | Pass | D07 (fixed) | ✅ |
| FR10 | `POST /api/mechanics/jobs/checklist-compliance` (compliant when all ticked; otherwise "Checklist Incomplete" + %) | TC16, TC32 | Pass | D11 (fixed) | ✅ |
| FR11 | Dashboard total completed jobs, date range (default last 30 days) | TC21, TC33 | Pass | — | ✅ |
| FR12 | `GET /api/manager/jobs/:id` | TC23 | Pass | — | ✅ |
| FR13 | Dashboard average repair time in hours (`workshopTime.js` conversion) | TC22, TC33, TC34 | Pass (failed in run 1, fixed, re-tested) | D10, D16 (fixed) | ✅ |
| FR14 | Dashboard acceptance %, filtered by decision date (`decided_at`) | TC21, TC33 | Pass | — | ✅ |
| FR15 | Dashboard compliance % from stored job results | TC32, TC33 | Pass | D11 (fixed) | ✅ |
| FR16 | Dashboard count of jobs closed with unticked items | TC32, TC33 | Pass | D11 (fixed) | ✅ |
| FR17 | `?mechanic=` filter on dashboard and jobs, combined with the date range | TC21, TC33 | Pass | D15 (fixed) | ✅ |
| NFR01 | `requireAccount`, role checks, `denyAccess()` logging | TC04, TC20, unit tests `auth.test.js` | Pass | — | ✅ |
| NFR02 | `services/notifications.js` outbox retries | TC26 | Pass | D05 (fixed) | ✅ |
| NFR03 | — (performance test) | TC29 | Not run | — | ⏳ |
| NFR04 | 3-step booking flow | TC06, TC30 | 3 steps pass; first-time customer not run | D12 (open) | ⚠️ (R04) |
| NFR05 | `services/checklists.js` versioning + manager editor | TC24 | Pass | D08 (fixed) | ✅ |
| NFR06 | Append-only `supersedes_entry_id` | TC18 | Pass | — | ✅ (R07 optional) |

**Acceptance criteria → test cases:**
- AC01–AC03: TC06, TC09
- AC04: TC08
- AC05: TC10
- AC06: TC11
- AC07–AC08: TC25
- AC09: TC19
- AC10: ❌ (R05)
- AC11: TC29
- AC12: TC13
- AC13: TC14
- AC14–AC15: TC17
- AC16: TC18
- AC17: TC15
- AC18: TC32
- AC19: TC21, TC22, TC32
- AC20: TC23
- AC21–AC22: TC20

**Coverage so far (after `b75c42a`):**
- **23** requirements (FR + NFR); **all 23 (100%)** have at least one linked test case. NFR03's case (TC29) is planned but not run.
- **21 of 23 (91%)** are fully verified (✅), up from 16 (70%) before the dashboard bundle. **1** is partial (⚠️): NFR04. **1** is unverified (⏳): NFR03.
- Acceptance criteria: **19 of 22** verified. AC10 is not built (R05). AC02 (3-second confirmation) and AC11 (load time) need timing measurements (TC29).

The A1 exit criterion was that "85%+ of in-scope requirements have at least one linked test case". **Met (100%).**

**Partially implemented / unverified / out-of-scope requirements, with justification:**
- **NFR04:** first-time customer has to leave the booking flow to add a vehicle (D12, fix R04).
- **NFR03:** performance test planned (Task 7).
- **AC10:** plate search still to build (R05).
- **Real email delivery:** out of scope (C10). The mocked outbox is verified instead.

---

## Task 3: Test cases and execution results

**Execution:**
- **Date:** 2026-10-08, two runs.
  - **Run 1:** before the dashboard bundle; 98 checks.
  - **Run 2:** after `b75c42a`; 118 checks (the 98 updated for new behaviour plus 20 new). Run 2 is the current result in the table below.
- **Environment:** Windows 11, Node.js, local server on a **fresh throwaway SQLite database** (`DB_PATH` in a temp folder, port 3099).
- **Method:** system and integration tests executed over HTTP by a temporary script (individual checks grouped into the test cases below). The reminder and retry cases called the scheduler directly with a simulated clock.
- **UI evidence (run 2):** screenshots in headless Edge of the manager dashboard (desktop and mobile), the invalid-range error, job details and the mechanic checklist.
- **Existing unit tests:** 10 automated tests (`node --test` in `backend/`), all passing.

**Types:**
- P = positive
- N = negative / invalid input
- B = boundary
- E = error handling
- S = security
- C = concurrency
- R = reliability

| ID | Title | Req | Type | Steps (summary) | Expected | Actual | Result |
|---|---|---|---|---|---|---|---|
| TC01 | Valid login | NFR01 | P | POST `/auth/login` customer1/123 | 200, token, role customer | As expected | Pass |
| TC02 | Wrong password rejected | NFR01 | N, S | Login customer1/999 | 401; attempt logged | As expected | Pass |
| TC03 | Session kept on reload | (A1 limitation) | P | GET `/auth/session` with saved token | 200, same user | As expected | Pass |
| TC04 | Missing or tampered token rejected | NFR01 | S | Session with no token, then with a modified signature | 401 both | As expected | Pass |
| TC05 | Sign-up validation | — | P, N | Valid sign-up; duplicate username; existing email; weak password and bad email | 201 / 409 / 409 / 400 | As expected | Pass |
| TC06 | Create booking: pending with reference | FR01, AC01, AC02 | P | Customer books vehicle + service + slot 5 days ahead | 201, status `pending`, `REF-…` reference; slot shows unavailable | As expected | Pass |
| TC07 | Taken slot rejected | FR02 | N | Second customer books the same slot | 409, no duplicate | As expected | Pass |
| TC08 | Two customers race for one slot | AC04 | C | Two booking requests for one slot sent at the same time | Exactly one 201, one 409 | 201 / 409 | Pass |
| TC09 | Invalid booking inputs | AC03 | N | Missing fields; past time; invalid service type; someone else's vehicle; mechanic booking | 400 / 400 / 400 / 403 / 403 with messages | As expected | Pass |
| TC10 | Cancel within 24h refused | FR03, AC05 | B | Cancel a confirmed booking 12h ahead (exactly-24h case covered by unit test) | 400 with "24 hours" message | As expected | Pass |
| TC11 | Cancel more than 24h ahead | FR04, AC06 | P | Cancel a booking 7 days ahead | 200; status `cancelled` with timestamp; gone from mechanic schedule; workshop email `sent`; slot can be rebooked | As expected | Pass |
| TC12 | Cancel in invalid states | FR04 | E, S | Cancel denied booking; cancel twice; cancel another customer's; cancel unknown ID | 400 / 400 / 403 / 404 | As expected | Pass |
| TC13 | Approve / deny notifies customer | FR07, AC12 | P | Mechanic approves one request and denies another | `confirmed` / `denied`; customer notice + email `sent` | As expected | Pass |
| TC14 | Decisions are final | AC13 | N | Re-decide an approved booking; invalid decision value | 400 / 400; decided requests leave the pending list | As expected | Pass |
| TC15 | Checklist matches service type | FR09, AC17 | P, N | Load full_service checklist; load invalid type | 10 full-service items / 400 | As expected | Pass |
| TC16 | Checklist completion | FR10 | P, N | Ticked item not on checklist; no items sent; wrong service type; unconfirmed booking; save fully ticked | 400 / 400 / 400 / 400 / 201 "Checklist Compliant", booking `completed`, customer notified | As expected | Pass |
| TC17 | Diagnostic entry linked to vehicle | FR08, AC14, AC15 | P, N | Add entry; unknown vehicle ID; invalid severity; missing description; customer attempt | 201 / 404 with message / 400 / 400 / 403 | As expected | Pass |
| TC18 | Diagnostic edits are append-only | NFR06, AC16 | P | Edit an entry, then view history | New entry references the original; original kept and marked superseded | As expected | Pass |
| TC19 | Vehicle history | FR06, AC09 | P | Customer views own vehicle history; new vehicle with no history | Newest first; fixes + flagged issues; empty state message | As expected | Pass |
| TC20 | Role-based access | NFR01, AC21, AC22 | S | Customer requests another customer's vehicles, bookings and history, all vehicles, mechanic portal, manager dashboard; staff view any history | 403 for customer; 200 for mechanic/manager; denials logged | 403s as expected; 20 denials logged | Pass |
| TC21 | Dashboard metrics and mechanic filter | FR11, FR14, FR17 | P | Load dashboard; filter by mechanic1; filter by unknown mechanic | Totals load; acceptance = approved ÷ decided (4 of 5 = 80%); filter applied; unknown mechanic gives 0 jobs | As expected (80%) | Pass |
| TC22 | Average repair time valid | FR13 | B | Complete a job before its slot, and a past booking (2026-09-05 09:00 NZST); load dashboard and job details | Early finish = 0 h and flagged; past job's duration equals an independent calculation; average in hours | Run 1: **−7,970 min (Fail, D16 + D10)**. Run 2: early = 0 min, flagged; duration 48,108 min = expected 48,108; average 267.3 h | **Pass** (re-test after fix) |
| TC23 | Completed job details | FR12, AC20 | P | Open a completed job; unknown job ID | Mechanic, notes, duration, checklist + version / 404 | As expected | Pass |
| TC24 | Checklist template editing | NFR05 | P, N, C | Edit WOF checklist; save again with the old version; invalid items; mechanic reloads; open the old job | New version 2 / 409 / 400 / mechanic gets version 2 straight away / old job still shows version 1 | As expected | Pass |
| TC25 | WOF and service reminders | FR05, AC07, AC08 | B, P | Vehicle with WOF and service due in 14 days; run the scheduler at 07:59, 08:00 and 09:00 NZ | Nothing at 07:59; WOF + service reminder at 08:00; no duplicates at 09:00 | As expected | Pass |
| TC26 | Email retry over 24h | NFR02 | R | Email whose sender always fails; process at 0, 8, 16, 24h | Retried each time, then `failed` after 4 attempts; booking data untouched | As expected | Pass |
| TC27 | Account management | — | P, N, S | Create mechanic; duplicate; invalid details; new mechanic logs in; manager deletes the account; reuse its token | 201 / 409 / 400 / 200 / 200 / 401 | As expected | Pass |
| TC28 | Login throttling | NFR01 (security) | S | Repeated failed logins | 429 after the limit | 429 returned, but successful logins also count (D17) | Pass (defect raised) |
| TC29 | History load time under 20 users | NFR03, AC11 | Performance | 20 concurrent users requesting vehicle history; record times | ≥95% under 2s | — | **Not run** |
| TC30 | First-time customer books in 3 steps | NFR04 | Usability | New account with no vehicle → book | ≤3 steps | — | **Not run** (expected fail: D12, fix R04) |
| TC31 | UI click-through per role | All | Usability, system | Manual browser walkthrough as customer, mechanic, manager | All screens and buttons work; messages clear | — | **Not run** |
| TC32 | Compliance % reflects partial checklists | FR10, FR15, FR16, AC18 | P | Close 3 jobs: 2 fully ticked, 1 with 4 of 7 ticked (mechanic confirms) | Incomplete job saved at 57% with exactly those 4 items; compliance 67%; incomplete = 1; avg completion 86%; job details show ✓/✗ per item | As expected | Pass |
| TC33 | Dashboard date range | FR11, FR13–FR17 | B, N | Default range; today only; tomorrow onwards; up to yesterday; jobs list with a range; start after end; invalid date (2026-02-30); mechanic + range | Default = last 30 days ending today; today's jobs counted only when today is in range; empty ranges show N/A; jobs list follows the range; 400 / 400 with messages; filters combine | As expected | Pass |
| TC34 | Migration of existing data | FR13, NFR06 (data integrity) | R | Start the new code on a copy of the real DB, and on a DB with old-format timestamps (`2026-09-06 02:30:00`) | Old timestamps converted to UTC ISO; decisions back-dated; old jobs show 100% with all items ticked; dashboard loads | As expected | Pass |

**Summary:**

| Run | Planned | Executed | Passed | Failed | Blocked | Not run |
|---|---|---|---|---|---|---|
| Run 1 (before `b75c42a`) | 33 | 28 | 27 | 1 | 2 | 3 |
| **Run 2 (after `b75c42a`)** | **34** | **31** | **31** | **0** | **0** | **3** |

**Execution pass rate (run 2):** 31 / 31 = **100%** (run 1: 27 / 28 = 96.4%).

**Failed test and corrective action:**
- **TC22** failed in run 1: average repair time was negative. Two causes: a job could be completed before its booked slot (D16), and completion time was stored as UTC while the slot is local time (D10).
- **Corrective action:** R02 in `b75c42a`, plus the team decision to count early finishes as 0 hours.
- **Re-test:** passed in run 2.
- **Regression:** all other run 1 cases re-run in run 2 and passed; TC32 and TC33 were unblocked and passed.

**Defect raised from a passing test:**
- **TC28**: the login limit also counts successful logins (D17).
- **Corrective action:** R09.

**Regression plan:** after each remaining feature (R04–R09), re-run all 31 executed cases plus TC30 once R04 is built. The automated suite (Task 4) runs on every commit.

**Remaining quality risks:**
- performance has not been measured (TC29);
- the UI has only been checked by screenshot, not a full manual click-through (TC31);
- open defects: D12, D13, D14, D17.

**Mapping from A1 test cases:**
- A1 TC01 → TC01
- TC02 → TC02
- TC03 → TC06
- TC04 → TC20
- TC05 → TC32 (now executed)
- TC06 → TC13
- TC07 → TC15
- TC08 → TC29 (history page instead of booking page, per NFR03)
- TC09 → TC21
- TC10 → TC32
- TC11 → TC23

---

## Task 4: Test automation plan

**Tool:** Node's built-in test runner (`node:test` + `node:assert`). It needs no extra dependencies, runs with `node --test`, and is the tool already used by the 10 existing tests.

**Currently automated (10 tests, all passing):**
- `auth.test.js`: 5 tests (tokens, role checks, denial logging).
- `security.test.js`: 2 tests (password hashing, rate limiter).
- `routes/bookings.test.js`: 3 tests (24h cancellation boundary).
- **Saved but not yet restored:** `reminders.test.js`, 7 tests (NZ date, 08:00 timing, no duplicates, retry timing). It is in `git stash@{0}`; see `PROJECT_NOTES.md` section 7.

**Selected for automation, and why:**

| Test cases | Why automate |
|---|---|
| TC10 + unit boundary tests (24h rule) | A boundary rule that is easy to break by changing `<` to `<=`; it has already had a defect (D09). |
| TC20, TC04, TC02 (access control) | Security-critical; must be re-checked on every change to any route. |
| TC07, TC08 (double booking, race) | Concurrency is impossible to check reliably by hand. |
| TC25, TC26 (reminders, retries) | Time-based; automation can fake the clock (08:00, +8h) instead of waiting real hours. |
| TC11, TC12 (cancellation states) | Many state combinations; a regression would silently corrupt data. |
| TC18, TC24 (append-only, checklist versions) | Data integrity rules that later changes could quietly break. |
| TC22, TC32, TC33, TC34 (metrics, date range, migration) | Exact numbers and date boundaries are tedious to check by hand, and they broke once already (D10). TC22's independent duration calculation is a good automated check against timezone regressions. |

**Kept manual / exploratory, and why:**
- **TC31 UI click-through** and **TC30 usability:** the layout, clarity of messages and number of steps need a human. UI automation (e.g. Playwright) would be slow to build and brittle for a prototype whose UI is still changing.
- **TC29 performance:** a one-off measurement with a load tool, not a pass/fail unit test on every commit.
- **Exploratory testing:** odd input combinations and role switching. Found D17 (login limit) during exploratory checks.

**Implementation step needed:** `server.js` starts listening as soon as it loads, so it must export `app` (and only call `listen()` when run directly). API tests can then start it on a random port against a temporary DB.

**Benefits:**
- fast (under 1s for the unit suite);
- repeatable;
- covers time-based and concurrency cases manual testing can't;
- gives a CI quality gate (Task 5).

**Limitations:**
- no UI coverage;
- the mock email means real delivery isn't tested;
- tests share the SQLite file unless each sets `DB_PATH` (currently `auth.test.js` uses the real `portal.db`, D14).

**Maintainability:**
- one test file per area;
- each test creates its own data in a temporary DB, so tests don't depend on each other;
- simulated time is passed in (e.g. `runReminderTick(db, { now })`) instead of mocking globals.

---

## Task 6: Defect management

**Severity:**
- **Critical:** data loss, a security breach, or the system unusable.
- **High:** a requirement is broken with no workaround.
- **Medium:** wrong behaviour with a workaround, or wrong results in a non-core area.
- **Low:** cosmetic or minor inconvenience.

**Priority:**
- **P1:** fix before any further work or the demo.
- **P2:** fix before release.
- **P3:** fix if time allows, or defer and document.

**Status:**
- **Open:** logged.
- **In progress:** being fixed.
- **Fixed:** code changed and committed.
- **Verified:** retested and passed (plus regression).
- **Closed:** accepted by the team.
- **Deferred:** won't fix this release; justified and documented.

**Lifecycle used:**

Found (testing, code review or exploratory checks) → logged in the register with ID, severity, priority and steps → Open → In progress (a fix in its own focused commit) → Fixed (commit hash recorded) → Verified (the failing test case re-run and passing, plus related cases re-run as regression) → Closed.

Defects that won't be fixed go to **Deferred**, with the justification recorded in the release decision.

**Register:** `PROJECT_NOTES.md` section 5 (D01–D17).

**Severity distribution (after `b75c42a`), 17 defects:**
- **Critical:** 0.
- **High:** 6 (D01, D02, D03, D08, D10, D16). **All fixed.**
- **Medium:** 7 (D04, D05, D07, D09, D11, D13, D17).
- **Low:** 4 (D06, D12, D14, D15).
- **Fixed:** 13 (D01–D11, D15, D16). **Open:** 4 (D13 and D17 Medium; D12 and D14 Low).

### RCA 1: D03, WOF reminders checked the wrong day (timezone)
- **Problem:** reminders were checked for "today + 14 days" using the UTC date. NZ is UTC+12/+13, so every morning the system thought it was still yesterday, and reminders could be missed or sent a day off.
- **5 Whys:**
  1. Why missed? The target date was a day early.
  2. Why? "Today" came from `new Date().toISOString()`.
  3. Why? `toISOString()` returns UTC, but the business runs on NZ time.
  4. Why wasn't it noticed? It was only ever tested in the afternoon, when the UTC and NZ dates match. There was no test with a fixed clock.
  5. Why? The AI-generated code assumed server time = business time, and the review didn't question timezone handling.
- **Root cause:** an implicit timezone assumption, and no time-controlled tests.
- **Corrective action:** compute dates in the workshop's timezone (`Intl.DateTimeFormat`, `Pacific/Auckland`), and test at 07:59, 08:00 and with dates around midnight UTC. When the same root cause showed up again in D10, all time conversions were moved into one shared helper (`services/workshopTime.js`) used by reminders, the dashboard and validation.
- **Prevention:** a project rule that all business dates use the workshop timezone, with automated tests using a fixed clock. The same root cause showed up again in **D10** (UTC completion vs local slot time). That fix now has a regression check (TC22) comparing against an independently calculated duration.

### RCA 2: D01, cancelled bookings were permanently deleted
- **Problem:** cancelling removed the booking row, losing the audit trail and skewing the acceptance and compliance metrics.
- **5 Whys:**
  1. Why deleted? The route ran `DELETE FROM bookings`.
  2. Why? The original FR04 said the booking "will be removed".
  3. Why was that taken literally? The AI-generated code followed the wording, not the intent (hide from views).
  4. Why wasn't it caught? The schema already had a `cancelled` status that was never used. Nobody compared the code with the schema or the A1 rewritten requirement.
  5. Why? There was no data-integrity review step for operations that delete records.
- **Root cause:** ambiguous requirement wording, combined with no review of destructive operations.
- **Corrective action:** cancellation sets `status = 'cancelled'` and `cancelled_at`; the record is kept and hidden from active lists. FR04 and AC06 reworded (C08).
- **Prevention:**
  - write requirements in terms of observable behaviour ("hidden from views"), not storage ("removed");
  - review every `DELETE` against the data integrity attribute.

### RCA 3: D08, editing a checklist template would rewrite completed jobs
- **Problem:** jobs pointed to a template row that could be edited in place, so changing a template would have changed the recorded checklist of every past job.
- **5 Whys:**
  1. Why would history change? Job details read the *current* template by `checklist_id`.
  2. Why? Templates had no versions; there was one row per service type.
  3. Why? The schema was designed before NFR05 (editable templates) was implemented.
  4. Why wasn't the conflict seen? The A1 maintainability attribute said changes apply to "all jobs", which hid the problem.
  5. Why? Requirements weren't cross-checked against the data integrity attribute.
- **Root cause:** a schema design that didn't anticipate change, plus an inconsistent requirement.
- **Corrective action:** versioned templates (each save adds a new version; jobs keep theirs); concurrent edits rejected (409). Attribute reworded to "all **new** jobs" (C04). Also fixed the related latent bug D07.
- **Prevention:** when a feature makes data editable, check what already references it, and apply the append-only pattern (as used for diagnostics, NFR06).

**How defect analysis improved quality:**
- It exposed a **recurring timezone pattern** (D03, then D10) and a **recurring "literal AI interpretation" pattern** (D01, D13).
- It led to requirement rewording (C04, C07, C08) and a consistent append-only approach (diagnostics, then checklists).
- It led to the plan to automate time-based and boundary tests.

---

## Task 7: Risk-based quality testing plan

**Risk scoring:** likelihood × impact (1–3 each).

| Quality area | Risk to this system | L | I | Score | Selected? |
|---|---|---|---|---|---|
| **Security (access control)** | Customers seeing other customers' vehicles, records or bookings; role bypass | 2 | 3 | 6 | ✅ |
| **Reliability (notifications)** | Reminders lost, duplicated or sent on the wrong day; a failure corrupting booking data | 3 | 2 | 6 | ✅ |
| **Data integrity** | History or checklists overwritten; cancelled records lost | 2 | 3 | 6 | ✅ (covered with reliability) |
| **Performance** | History page slow under 20 users (NFR03) | 1 | 2 | 2 | ✅ (requirement exists) |
| Usability | Booking takes more than 3 steps; unclear errors | 2 | 2 | 4 | Partly (TC30, TC31) |
| Accessibility / compatibility | Screen readers, Safari/Chrome differences | 1 | 1 | 1 | Out of scope (desktop prototype) |

**Selected areas, methods and evidence:**

1. **Security** (NFR01, AC21, AC22)
   - **Method:** attempt every cross-role and cross-customer request; tampered, expired and missing tokens; deleted-user tokens; repeated failed logins; check the denial logs.
   - **Evidence so far:** TC02, TC04, TC20, TC27, TC28 all pass; 20 denials logged with user, role, path and reason.
   - **Found:** D17 (the login limit counts successful logins).
   - **Limitations:** no penetration testing; tokens are stored in `localStorage` (XSS risk); single-process rate limiter.
   - **Recommendations:** count only failed logins; HTTP-only cookies; a shared rate-limit store if deployed.
2. **Reliability** (NFR02, FR05, AC08)
   - **Method:** simulate email failure (`MOCK_EMAIL_FAILURE_RATE` or a failing sender) and check retries at 0/8/16/24h; restart the server to check for duplicates; run the scheduler at boundary times.
   - **Evidence:** TC25, TC26 pass; booking and history data unchanged after failed sends.
   - **Limitations:** reminders missed while the server is down are not sent later; email is mocked.
   - **Recommendations:** catch-up for missed days; a real provider with delivery receipts.
3. **Performance** (NFR03, AC11), **planned, not yet run (TC29)**
   - **Method:** seed realistic data (e.g. 50 vehicles × 30 entries), then run 20 concurrent clients requesting `/api/vehicles/:id/history` for 60s with a load tool (e.g. `autocannon` via `npx`), recording p95 latency.
   - **Pass criterion:** p95 < 2s.
   - **Before testing:** add an index on `diagnostic_entries(vehicle_id)` (R08), then compare before and after.
   - **Limitations:** localhost only (no network latency), a single machine.

---

## Task 11: Contribution evidence (from git, 2026-10-08)

| Member | Commits (non-merge) | Lines (+/−)* | Main areas (from commit history) |
|---|---|---|---|
| Daniel (Daniel-Massey1) | 24 | +4,722 / −446 | Original customer booking portal and DB backend; booking validation; accounts and own-vehicle access; persistent login; history access fix; cancellation as status and decision notifications (email outbox); WOF/service reminders rework; manager checklist template editor (versioning); manager dashboard date range, real checklist compliance and repair time fix; README; project notes; report draft |
| Sam | 14 | +5,023 / −385 | Mechanic portal (approvals, diagnostic entry form, dynamic checklists); append-only vehicle history with previous-entry dropdown; login with role verification; landing page; sign-up and manager-created mechanic accounts; time-slot booking; add vehicle; customer portal and styling; inclusive 24h cancellation rule + unit tests |
| Patrick (patrick-setu) | 6 | +485 / −9 | Manager dashboard (backend route and frontend); mechanic decision tracking column (`decided_by`) for dashboard metrics; mechanic route update for DB changes; WOF reminder service in the server |

\*Line counts come from `git log --numstat` and include generated files (e.g. `package-lock.json`), so treat them as rough. Commit counts and the work areas are better evidence.

**Still to add per member:** testing work, documentation sections written, demo role, and the individual reflection (Task 11 requires one each).

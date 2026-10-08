# SQA Mechanic System

## Quick start

From the project root, run:

```powershell
cd backend
npm install
npm start
```

The server starts at `http://localhost:3001`. Open that address in a browser and log in with one of the demo accounts below.

To stop the server, press `Ctrl+C` in the terminal.

## Demo Accounts
The prototype includes four demo accounts (customers can also sign up, and managers can create or remove accounts):

- `customer1` / `123`
- `customer2` / `123`
- `mechanic1` / `123`
- `manager1` / `123`

The backend verifies these credentials against SQLite and issues signed, expiring bearer tokens. Demo accounts are seeded only outside production. New customer and mechanic accounts require passwords of 8 to 128 characters.

For a fresh production database, configure `AUTH_SECRET`, `INITIAL_MANAGER_USERNAME`, and `INITIAL_MANAGER_PASSWORD` (at least 16 characters) for the initial manager. Remove or reset any demo accounts before deploying an existing development database.

Login and sign-up requests are throttled per client IP. The current limiter is process-local, so a multi-worker production deployment should use a shared rate-limit store.

## Running the tests

```powershell
cd backend
node --test
```

This runs every `*.test.js` file under `backend/` (authentication, access control, password hashing, rate limiting and booking cancellation rules).


## Email notifications (mocked)

No real email is sent. Every notification is written to the `notifications` outbox table and "delivered" by logging `[MOCK EMAIL]` to the server console, so the table is the record of what was sent and when.

- **Booking approved/declined** - the customer is emailed immediately and sees the outcome on their booking card.
- **Booking cancelled** - the booking is marked `cancelled` (never deleted) and the workshop booking address (`WORKSHOP_EMAIL`) is emailed.
- **WOF and service reminders** - at 8:00am workshop time (`WORKSHOP_TIMEZONE`, default `Pacific/Auckland`) each day, vehicles whose WOF expiry or service due date is exactly 14 days away are queued a reminder. Each reminder is only ever queued once per vehicle and due date, so restarting the server does not send duplicates.
- **Retries** - a failed send is retried every 8 hours, up to 3 retries (24 hours), then marked `failed`. Set `MOCK_EMAIL_FAILURE_RATE` (0 to 1) to demonstrate this.

## Viewing the database

Recommended: DB Browser for SQLite

1. Stop the backend if it is running, or open the database in read-only mode.
2. Install and open [DB Browser for SQLite](https://sqlitebrowser.org/).
3. Select **Open Database**.
4. Open `backend/db/portal.db`.
5. Use **Browse Data** to view rows.
6. Use **Execute SQL** to run queries or insert data.
7. Select **Write Changes** after making edits.


## About the project

The SQA Mechanic System is a workshop portal prototype for an automotive workshop, with three roles:

- **Customers** book services, manage their vehicles, cancel eligible bookings and view vehicle history.
- **Mechanics** approve or deny booking requests, complete service checklists and record diagnostic entries.
- **Managers** review workshop quality metrics, manage checklist templates and manage accounts.

The application is split into a static frontend and a Node.js backend. The backend uses Express for the API and SQLite for local data storage. Sample data is created automatically when the application is started for the first time.

## Main features

**Customer**
- Three-step booking: vehicle, service and time slot, confirm. Taken slots are rejected.
- Booking list with upcoming and past bookings, plus approval, decline and cancellation notices
- Cancellation more than 24 hours ahead (kept as a cancelled record for auditing)
- My Vehicles: add vehicles with WOF expiry and next service due dates
- WOF and service due reminders 14 days ahead, with retries
- Vehicle history: fixes and issues flagged for the next visit, newest first
- Customer self-registration

**Mechanic**
- Approve or deny pending booking requests (the customer is notified)
- Service checklists loaded for the booking's service type. Fully ticked jobs are saved as checklist compliant; a job can also be closed with items unticked (after confirming), saved as "Checklist Incomplete" with its completion %
- Diagnostic entries, append-only: edits are stored as new entries linked to the original
- Vehicle history for every vehicle

**Manager**
- Quality dashboard: completed jobs, incomplete checklists, average repair time (hours), acceptance rate, checklist compliance and average checklist completion. Filter by mechanic and by date range (from/to, default last 30 days)
- Completed job details: mechanic, repair details, duration, checklist version used, and which items were ticked
- Service checklist editor: edits are saved as new versions, new jobs use the latest version, and completed jobs keep the version they were done with
- People & access: create mechanic accounts and remove customer or mechanic sign-in access

**Platform**
- Role-based access checked by the backend on every request, with denied attempts logged
- Mocked email notifications through a retrying outbox (see above)
- SQLite database for local development, created and seeded automatically
- Basic health-check endpoint for the backend

## Requirements

- Node.js with npm installed
- A current LTS version of Node.js is recommended
- DB Browser for SQLite is optional and only needed to inspect or edit the database directly

## Using the application

1. Start the backend using the Quick start commands above.
2. Open `http://localhost:3001` in a browser and **Log in** with a demo account, or **Sign up** as a new customer.

**As a customer**
- **My Vehicles**: add a vehicle, with its WOF expiry and next service date.
- **Book a Service**: select a vehicle, service and time slot, then confirm. The booking stays pending until a mechanic approves it.
- **My Bookings**: view upcoming and past bookings, or cancel one more than 24 hours ahead.
- **Vehicle History**: view the selected vehicle's previous records.

**As a mechanic**
- **Mechanic Portal**: approve or deny requests, complete the service checklist for a confirmed booking, and add diagnostic entries.
- **Vehicle History**: view and edit diagnostic entries for any vehicle.

**As a manager**
- **Manager Dashboard**: view quality metrics, filter by mechanic and date range, and select a completed job to see its details and which checklist items were ticked.
- **People & access**: add mechanics or remove a customer's or mechanic's sign-in account.
- **Service checklists**: edit the checklist for each service type and view previous versions.

Deleting an account removes its ability to sign in, but preserves customer profiles, vehicles, and service history for recordkeeping. The prototype does not include email verification or password recovery, so use non-sensitive demo credentials.

## Project structure

```text
backend/
	db/db.js          Database schema, migrations and seed data
	routes/           API routes: auth, bookings, vehicles, mechanics, manager
	services/         Notifications outbox, WOF/service reminders, checklist versions, workshop timezone helper
	auth.js           Token signing, role checks and denied-access logging
	passwords.js      Password hashing
	rateLimit.js      Login and sign-up throttling
	*.test.js         Automated tests (also routes/*.test.js)
	server.js         Express server and static file host
	package.json      Backend scripts and dependencies
frontend/
	index.html        Portal page (customer, mechanic and manager views)
	app.js            Frontend behavior and API requests
	style.css         Portal styling
docs/
	PROJECT_NOTES.md  Assessment notes: requirement status, changes, defects, remaining work
```

## Troubleshooting

- If `npm install` fails while installing `better-sqlite3`, use a current LTS version of Node.js and run the command again.
- If port `3001` is already in use, stop the other process or start the backend with a different `PORT` value.
- If the page cannot reach the API, confirm that the backend terminal is still running and visit `http://localhost:3001/api/health`.

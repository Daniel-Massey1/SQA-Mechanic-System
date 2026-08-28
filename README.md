# SQA Mechanic System

## Quick start

From the project root, run:

```powershell
cd backend
npm install
npm start
```

The server starts at `http://localhost:3001`. Open that address in a browser to use the customer portal.

To stop the server, press `Ctrl+C` in the terminal.

### Recommended: DB Browser for SQLite

1. Stop the backend if it is running, or open the database in read-only mode.
2. Install and open [DB Browser for SQLite](https://sqlitebrowser.org/).
3. Select **Open Database**.
4. Open `backend/db/portal.db`.
5. Use **Browse Data** to view rows.
6. Use **Execute SQL** to run queries or insert data.
7. Select **Write Changes** after making edits.


## About the project

The SQA Mechanic System is a customer booking portal prototype for an automotive workshop. It provides a simple interface for customers to select a vehicle, choose a service, book an available time, view existing bookings, cancel eligible bookings, and review vehicle history.

The application is split into a static frontend and a Node.js backend. The backend uses Express for the API and SQLite for local data storage. Sample data is created automatically when the application is started for the first time.

## Main features

- Customer service booking workflow
- Vehicle selection and service type selection
- Booking confirmation and booking list
- Booking cancellation for eligible bookings
- Vehicle service and diagnostic history
- SQLite database for local development
- Basic health-check endpoint for the backend

## Requirements

- Node.js with npm installed
- A current LTS version of Node.js is recommended
- DB Browser for SQLite is optional and only needed to inspect or edit the database directly

## Using the application

1. Start the backend using the Quick start commands above.
2. Open `http://localhost:3001` in a browser.
3. Use **Book a Service** to select a vehicle, service, and time slot.
4. Use **My Bookings** to view or cancel bookings.
5. Use **Vehicle History** to view the selected vehicle's previous records.

This prototype uses sample customer data and does not include real authentication.

## Project structure

```text
backend/
	db/db.js          Database connection and setup
	routes/           Vehicle and booking API routes
	server.js         Express server and static file host
	package.json      Backend scripts and dependencies
frontend/
	index.html        Customer portal page
	app.js            Frontend behavior and API requests
	style.css         Portal styling
```

## Troubleshooting

- If `npm install` fails while installing `better-sqlite3`, use a current LTS version of Node.js and run the command again.
- If port `3001` is already in use, stop the other process or start the backend with a different `PORT` value.
- If the page cannot reach the API, confirm that the backend terminal is still running and visit `http://localhost:3001/api/health`.
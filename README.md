# On-Tour v5 — PostgreSQL Edition

This version replaces the local `ontour-data.json` file with a **persistent PostgreSQL database**.
Client accounts and tour requests now survive web-service restarts and redeployments.

## Deploy on Render

1. Create a **Render Postgres** database in the same region as your web service.
2. Open the database's **Connect** section and copy its **Internal Database URL**.
3. Open the On-Tour **Web Service → Environment** and set:
   - `DATABASE_URL` = the Internal Database URL (do not publish it)
   - `ADMIN_PASSWORD` = your strong Admin password
   - `SESSION_SECRET` = a fixed random secret with 32+ characters
4. Replace the existing GitHub repository files with this ZIP's contents.
5. Keep **Build Command** `npm install` and **Start Command** `npm start`.
6. Deploy. The application automatically creates the `clients` and `tour_requests` tables and an index that prevents two approved tours from using the same date/time.
7. Open `/`, sign up, and submit a test request. Open `/admin`, log in, and approve it.

## Stored data

- `clients`: id, name, unique email, salted scrypt password hash, registration timestamp
- `tour_requests`: client association, apartment, date, time, notes, status, timestamp, optional room code

SQL queries are parameterized. The database has a unique constraint on client emails and a partial unique index on approved tour slots.

## Important

- This upgrade **does not automatically import** data from the old `ontour-data.json`. Existing accounts and tour requests must be migrated separately if you need to preserve them.
- Chat messages and live WebRTC rooms are still in memory; they are not stored in PostgreSQL.
- Tour approval does not automatically create a video room.
- Use a persistent `SESSION_SECRET`; changing it logs out existing sessions.
- Production security still needs rate limiting, CSRF protections, and operational monitoring.
- Date/time validation follows the server's timezone for the one-hour-ahead check; set a consistent booking timezone before taking real bookings.
- Database availability, service plan, and backup retention depend on your Render Postgres plan. Check your plan's expiration and backup settings.
- Video calls still need TURN configuration on restricted networks.
- Tested: JavaScript syntax and ZIP integrity. Not tested: a live Render PostgreSQL connection or end-to-end user flows.

## v5.1 Fixes
- `/admin` now serves a real admin dashboard with login and tour approvals.
- Admin video room: `/call?admin=1`; client video room: `/call`.
- Corrected email validation in client registration.
- Homepage now displays account-loading errors instead of only logging them.
- PostgreSQL credentials and environment variables remain required.

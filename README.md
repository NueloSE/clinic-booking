# Clinic Booking

An API that lets patients book clinic appointment slots, and a small web page
that uses it. Built for Task 1 of the Koya Cohort 4 assessment, following the
[technical spec](https://koyaacademy.com/assessment-api). All five levels are done.

- **Web page:** https://clinic-booking-omega-eight.vercel.app
- **API base URL:** https://clinic-booking-omega-eight.vercel.app (same origin)

Every API request needs the `X-API-Key` header. The page asks for the key once
and sends it with each call.

## Stack

- **API:** Node.js, Express 5, `pg`. No ORM or other libraries.
- **Database:** PostgreSQL on Neon.
- **Web page:** React, built with Vite.
- **Hosting:** Vercel. The API runs as a function in Cleveland (`cle1`), next to
  the database in Ohio (`us-east-2`). The page is served from Vercel's CDN.

## What each level does

| Level | Endpoints | How |
|---|---|---|
| 1 | `POST /reset`, `GET /slots`, `POST /bookings`, `GET /bookings/{id}` | Slots and bookings live in Postgres. `available` is worked out on each request, never stored. |
| 2 | all | API key checked before anything else (constant-time compare). Bookings with missing, empty or invalid fields get 400, an unknown slot 404, a slot that has started 400. Names and emails are trimmed, emails stored in lower case. |
| 3 | `POST /bookings`, `DELETE /bookings/{id}` | A partial unique index allows one confirmed booking per slot, so the database rejects a second one even when requests arrive together (409). Cancelling sets `status` to `cancelled`, which frees the slot. |
| 4 | `POST /bookings`, `GET /bookings` | `Idempotency-Key`: the first request saves its response; a retry with the same key and body gets the same response, a different body gets 422. Bookings are listed oldest first with an opaque cursor. |
| 5 | `POST /bookings` | At most 5 attempts per email per minute, failed ones included. The 6th gets 429 with `Retry-After`. Other emails aren't affected. |

Every error response is `{"error": "<message>"}`.

## Design decisions

- **The database enforces the rules.** Double booking, idempotency and the rate
  limit are all decided in Postgres, not in server memory. They hold across
  restarts and across several copies of the app, which matters on serverless.
- **No "is it free?" check before booking.** Two requests could both pass it. The
  insert uses `ON CONFLICT ... DO NOTHING` against the unique index, and no row
  back means 409.
- **Idempotency keys are claimed first.** A request inserts its key before
  booking, inside one transaction. A second request with the same key waits on
  that row, then replays the saved response, so it can never book twice. A 429
  is not saved, so a retry after waiting gets a real attempt.
- **Rate limit with a per-email lock.** `pg_advisory_xact_lock` on the email makes
  "count recent attempts, then record this one" safe under concurrent requests.
  The window slides: only the last 60 seconds count. `Retry-After` is the time
  until the oldest attempt leaves the window, rounded up.
- **Paging uses `seq`, an increasing number per booking.** `created_at` can tie
  within a millisecond; `seq` can't, so no booking is skipped or repeated
  between pages. The cursor is that number, base64url-encoded.
- **Slot times are stored twice:** the exact strings sent to `/reset` (returned
  unchanged) and parsed `timestamptz` values for sorting and the "has it
  started?" check, which uses the database clock.

## Known limits

- The API key belongs to the app, not a patient. Anyone with it can list or
  cancel any email's bookings. The spec has no user accounts; a real clinic would
  add patient sign-in (for example a one-time email link).
- `POST /reset` also clears idempotency keys and rate-limit counters, so each
  check starts clean.

## Running it locally

You need Node.js 20.19 or newer and a Postgres database (a free Neon project works).

```bash
npm install
cp .env.example .env     # fill in DATABASE_URL and API_KEY
npm run build            # build the web page into public/
npm run dev              # http://localhost:3000, creates the tables on start
npm run seed             # load demo slots (Mon to Fri, next 4 weeks)
```

To work on the page with live reload, run `npm run dev` and `npm run dev:web`
together, then open http://localhost:5173.

## Tests

`test/api.test.js` checks every rule in the spec against a running server,
including the concurrent cases (20 bookings for one slot, 10 retries with one
key, 10 attempts for one email).

```bash
npm test                                    # against the local server
BASE_URL=https://... API_KEY=... npm test   # against a deployment
SLOW=1 npm test                             # also waits out a real Retry-After
```

Each test calls `POST /reset`, which deletes all bookings.

## Deploying to Vercel

`vercel.json` sets the framework to Express, builds the page and picks the
`cle1` region. Set `DATABASE_URL` and `API_KEY` in the project's environment
variables, then create the tables once:

```bash
DATABASE_URL='postgresql://...' npm run migrate
```

## Project layout

```
src/app.js         every endpoint and middleware
src/db.js          connection pool, migrate(), withTransaction()
src/schema.sql     tables and indexes
src/server.js      local server (runs migrate, then listens)
web/src/           the React page
scripts/seed.js    demo slots
scripts/migrate.js creates the tables
test/api.test.js   end-to-end tests
```

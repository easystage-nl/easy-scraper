# easy-stage

Cloudflare Worker that polls **stagemarkt.nl** every 10 minutes for a fixed
search query, stores every listing it sees in a D1 database, and pings a
**Discord webhook** when a new listing appears.

The reverse-engineered API docs live in [`reversal/README.md`](reversal/README.md).

## Stack

- **Worker** — `src/index.ts`. Runs on a `*/10 * * * *` cron trigger and also
  exposes `GET /listings`, `GET /runs`, `POST /run` for manual checks and
  later visualization.
- **D1** — SQLite at the edge. Schema in [`schema.sql`](schema.sql). Stores
  full listing payloads in `raw_json` so future viz code is forward-compatible.
- **Discord** — webhook URL stored as a Worker secret.

## Setup

```bash
npm install

# 1. Cloudflare auth (opens browser)
npx wrangler login

# 2. Create the D1 database, then paste the returned database_id into
#    wrangler.toml under [[d1_databases]].
npx wrangler d1 create stagemarkt

# 3. Apply the schema (remote = production, local = `wrangler dev`)
npm run db:init
npm run db:init:local

# 4. Set the Discord webhook URL as a secret
npx wrangler secret put DISCORD_WEBHOOK_URL
# paste: https://discord.com/api/webhooks/<id>/<token>

# 5. Deploy
npm run deploy
```

## Configuring the search query

All query params live in `wrangler.toml` under `[vars]`:

```toml
NIVEAU          = "4"
TYPE            = "1"
RANGE_KM        = "75"
CREBOCODE       = "25998"          # Software developer
PLAATS_POSTCODE = "Warnsveld"      # also accepts a postcode like "7231CM"
BUITENLAND      = "false"
```

Edit and re-deploy. To find a `crebocode`, hit the suggestions endpoint:

```bash
curl 'https://stagemarkt.nl/api/query-hub/opleiding-suggesties?siteId=STAGEMARKT&niveau=4&term=software&pageSize=10'
```

## How "new listing" detection works

There is no publication-date field in the upstream API and no
"sort by newest" mode (verified — see `reversal/README.md`). So the worker
fetches the **full result set** every cron tick (`pageSize=1000`, fits in one
call for any sane query) and diffs `leerplaatsId`s against the D1 `listings`
table:

- IDs we've never seen → insert with `notified_at = NULL`, ping Discord, then
  set `notified_at = now`.
- IDs we already had → bump `last_seen_at`, clear `removed_at` if it was set.
- IDs we previously had but aren't in this scrape → set `removed_at = now`.
- **First run** (no completed `scrape_runs` row): insert all current listings
  with `notified_at = now` so we don't flood the channel on initial deploy.

## HTTP endpoints (for debug / future viz)

- `POST /run` — trigger a scrape immediately
- `GET /listings?active=true&limit=100` — current listings as JSON
- `GET /runs` — last 50 scrape executions with timing / new / removed counts

## Local development

```bash
npm run dev                           # starts wrangler dev on :8787
npm run trigger:local                 # fire the cron handler once
curl http://localhost:8787/listings   # inspect the local D1 state
```

## Visualization (later)

D1 holds:
- `listings` — full payload + `first_seen_at`, `last_seen_at`, `removed_at`,
  `lat`/`lon`. Enough for: timeline of discovery, map of where listings
  cluster, time-on-market histogram, organisation leaderboard.
- `scrape_runs` — one row per cron tick with totals. Enough for a "results
  over time" line chart.

Add a `GET /stats` endpoint to `src/index.ts` and a tiny Worker-served HTML
page (or a separate Pages site reading from the same D1) when you're ready.

# easy-scraper

Cloudflare Worker that scrapes **stagemarkt.nl** and stores every MBO internship
listing in D1.

A single broad query is capped by upstream at the 10 000 listings nearest a
postcode, so instead the worker sweeps **per study (crebocode)** — each study
stays under that cap, and the union is the full national set (~470 studies /
~140k listings). The hourly cron runs one query per study (~540 calls),
streaming each study's listings straight into D1 and discarding them, so the
full set is never held in memory at once. Removals are reconciled against the
whole table after a completed sweep.

> **Requires the Workers Paid + D1 Paid plans.** The initial backfill writes
> ~140k rows (over Free D1's 100k/day) and the per-run CPU exceeds the Free
> 10 ms limit. See `[limits] cpu_ms` in `wrangler.toml`.

The JSON API is deployed to `api.easystage.nl`. The dashboard frontend is a
separate worker on `easystage.nl` — see [`easy-dash`](https://github.com/easystage-nl/easy-dash).
Reverse-engineered API notes: [`reversal/README.md`](reversal/README.md).

## Endpoints

- `GET /listings` — filtered, paginated listings → `{ items, total }`.
  Params: `status` (active·removed·all), `q`, `plaats`, `leerweg`,
  `sort` (newest·recent·title), `limit` (≤500), `offset`.
- `GET /stats` — `{ active, removed, total }` counts.
- `GET /facets` — distinct `{ plaatsen, leerwegen }` for filter dropdowns.
- `GET /runs` — last 50 scrape runs.
- `POST /run` — trigger a full scrape now (synchronous; first backfill ~30-60s).

## Config

Query params + `CORS_ORIGIN` live in `wrangler.toml` under `[vars]`; `CREBOCODE`
there is ignored (the sweep covers every study).

## Develop & deploy

```bash
npm install
npm run dev      # wrangler dev on :8787
npm run deploy   # wrangler deploy
```

First-time setup also needs `wrangler login`, `wrangler d1 create stagemarkt`
(paste the id into `wrangler.toml`), and `npm run db:init`.

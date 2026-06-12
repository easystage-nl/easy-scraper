# easy-scraper

Cloudflare Worker that polls **stagemarkt.nl** every 10 min for a fixed search
query and stores listings in D1.

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
- `POST /run` — trigger a scrape now.

## Config

Search query + `CORS_ORIGIN` live in `wrangler.toml` under `[vars]`.

## Develop & deploy

```bash
npm install
npm run dev      # wrangler dev on :8787
npm run deploy   # wrangler deploy
```

First-time setup also needs `wrangler login`, `wrangler d1 create stagemarkt`
(paste the id into `wrangler.toml`), and `npm run db:init`.

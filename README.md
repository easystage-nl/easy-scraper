# easy-scraper

Cloudflare Worker that polls **stagemarkt.nl** every 10 min for a fixed search
query, stores listings in D1, and pings a **Discord webhook** on new ones.

The JSON API is deployed to `api.easystage.nl`. The dashboard frontend is a
separate worker on `easystage.nl` — see [`easy-dash`](https://github.com/easystage-nl/easy-dash).
Reverse-engineered API notes: [`reversal/README.md`](reversal/README.md).

## Endpoints

- `POST /run` — trigger a scrape now
- `GET /listings?active=true&limit=100` — listings as JSON
- `GET /runs` — last 50 scrape runs

## Config

Search query + `CORS_ORIGIN` live in `wrangler.toml` under `[vars]`; the Discord
webhook is a secret (`wrangler secret put DISCORD_WEBHOOK_URL`).

## Develop & deploy

```bash
npm install
npm run dev      # wrangler dev on :8787
npm run deploy   # wrangler deploy
```

First-time setup also needs `wrangler login`, `wrangler d1 create stagemarkt`
(paste the id into `wrangler.toml`), and `npm run db:init`.

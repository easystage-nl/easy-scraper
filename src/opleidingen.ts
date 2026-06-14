// Crebocode → opleiding-name lookup, built from stagemarkt's
// `opleiding-suggesties` autocomplete endpoint. listings only store the numeric
// `crebocode`; this table gives each one a human-readable label so the dashboard
// can filter and display by study program.

const BASE = "https://stagemarkt.nl/api/query-hub";

// The endpoint requires a niveau; "" returns an error. MBO runs levels 1-4, so
// we sweep all four and dedupe by crebocode.
const NIVEAUS = [1, 2, 3, 4] as const;

interface Suggestie {
  creboCode: number;
  label: string;
}

interface SuggestieResponse {
  body?: { data?: { items?: Suggestie[] } };
}

export interface Opleiding {
  crebocode: string;
  label: string;
  niveaunaam: string;
}

async function fetchNiveau(siteId: string, niveau: number): Promise<Opleiding[]> {
  const url = new URL(`${BASE}/opleiding-suggesties`);
  url.searchParams.set("siteId", siteId);
  url.searchParams.set("niveau", String(niveau));
  url.searchParams.set("term", "");
  url.searchParams.set("pageSize", "2000");

  const res = await fetch(url.toString(), {
    headers: {
      accept: "application/json",
      "user-agent": "easy-stage-scraper/0.1 (+https://github.com/vasie1337/easy-stage)",
      referer: "https://stagemarkt.nl/",
    },
    cf: { cacheTtl: 0, cacheEverything: false },
  });
  if (!res.ok) {
    throw new Error(`opleiding-suggesties niveau=${niveau} ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as SuggestieResponse;
  const items = data.body?.data?.items ?? [];
  return items.map((it) => ({
    crebocode: String(it.creboCode),
    label: it.label,
    niveaunaam: `Niveau ${niveau}`,
  }));
}

// Fetch every opleiding across all niveaus and upsert into the lookup table.
// Idempotent and cheap (4 requests); safe to call on every scrape so new
// programs and renamed labels stay current. Returns the row count written.
export async function refreshOpleidingen(db: D1Database, siteId: string): Promise<number> {
  // Self-heal: create the table if a fresh DB hasn't had schema.sql applied.
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS opleidingen (
         crebocode  TEXT PRIMARY KEY,
         label      TEXT NOT NULL,
         niveaunaam TEXT,
         updated_at INTEGER NOT NULL
       )`,
    )
    .run();

  const byCrebo = new Map<string, Opleiding>();
  for (const niveau of NIVEAUS) {
    for (const o of await fetchNiveau(siteId, niveau)) {
      // First niveau wins; crebocodes are unique to one level in practice.
      if (!byCrebo.has(o.crebocode)) byCrebo.set(o.crebocode, o);
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const stmts = [...byCrebo.values()].map((o) =>
    db
      .prepare(
        `INSERT INTO opleidingen (crebocode, label, niveaunaam, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(crebocode) DO UPDATE SET
           label = excluded.label,
           niveaunaam = excluded.niveaunaam,
           updated_at = excluded.updated_at`,
      )
      .bind(o.crebocode, o.label, o.niveaunaam, now),
  );

  for (let i = 0; i < stmts.length; i += 100) {
    await db.batch(stmts.slice(i, i + 100));
  }
  return byCrebo.size;
}

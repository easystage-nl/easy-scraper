import type { Listing } from "./types";

// D1 caps bound parameters at 100 per statement.
const D1_PARAM_LIMIT = 90;

// Statements per db.batch() call. D1 rejects oversized batches, so a large
// study's upserts are split into transactions of this size.
const BATCH_SIZE = 100;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Run a D1 batch, retrying on transient overload ("DB is overloaded. Requests
// queued for too long."). Writes are already serialized upstream; this just
// absorbs the occasional spike with a short backoff instead of dropping a study.
async function batchWithRetry(db: D1Database, stmts: D1PreparedStatement[]): Promise<void> {
  const delays = [150, 400, 1000];
  for (let attempt = 0; ; attempt++) {
    try {
      await db.batch(stmts);
      return;
    } catch (e) {
      const overloaded = e instanceof Error && /overloaded|queued for too long/i.test(e.message);
      if (!overloaded || attempt >= delays.length) throw e;
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }
}

// Every known crebocode from the opleidingen lookup. Excludes the empty
// sentinel. This is the list the scrape sweeps over.
export async function listCrebocodes(db: D1Database): Promise<string[]> {
  const res = await db
    .prepare("SELECT crebocode FROM opleidingen WHERE crebocode <> '' ORDER BY crebocode")
    .all<{ crebocode: string }>();
  return (res.results ?? []).map((r) => r.crebocode);
}

// ---------------------------------------------------------------------------
// Run bookkeeping
// ---------------------------------------------------------------------------

export async function startRun(
  db: D1Database,
  startedAt: number,
  queryParams: string,
): Promise<number> {
  const res = await db
    .prepare("INSERT INTO scrape_runs (started_at, query_params) VALUES (?, ?)")
    .bind(startedAt, queryParams)
    .run();
  return res.meta.last_row_id as number;
}

export async function finishRun(
  db: D1Database,
  runId: number,
  finishedAt: number,
  totalCount: number,
  newCount: number,
  removedCount: number,
  error: string | null,
): Promise<void> {
  await db
    .prepare(
      `UPDATE scrape_runs
         SET finished_at = ?, total_count = ?, new_count = ?,
             removed_count = ?, error = ?
       WHERE id = ?`,
    )
    .bind(finishedAt, totalCount, newCount, removedCount, error, runId)
    .run();
}

// ---------------------------------------------------------------------------
// Listing diff
// ---------------------------------------------------------------------------

// Lightweight snapshot of every row we already hold: id + removed_at only,
// never raw_json — so the whole-table diff costs a few MB of memory (~140k tiny
// entries), not the hundreds of MB the payloads would take.
export async function loadKnown(
  db: D1Database,
): Promise<Map<string, { removed: boolean }>> {
  const res = await db
    .prepare("SELECT leerplaats_id, removed_at FROM listings")
    .all<{ leerplaats_id: string; removed_at: number | null }>();
  const known = new Map<string, { removed: boolean }>();
  for (const r of res.results ?? []) {
    known.set(r.leerplaats_id, { removed: r.removed_at !== null });
  }
  return known;
}

// Upsert a batch of listings. The diff happens in SQL: ON CONFLICT only writes
// a row when its payload actually changed or it was previously removed (i.e.
// just came back), so steady-state runs write almost nothing and we never pull
// the table into the Worker. Caller is responsible for new/removed accounting
// (see loadKnown) — this just persists.
export async function upsertListings(
  db: D1Database,
  listings: Listing[],
  now: number,
): Promise<void> {
  if (listings.length === 0) return;

  const stmts = listings.map((l) =>
    db
      .prepare(
        `INSERT INTO listings (
           leerplaats_id, crebocode, titel, wervende_titel, leerweg, startdatum,
           bedrag_van, bedrag_tot, dagen_per_week,
           plaats, postcode, straat, huisnummer, lat, lon,
           org_id, org_leerbedrijf_id, org_naam, org_logo_url,
           first_seen_at, last_seen_at, raw_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(leerplaats_id) DO UPDATE SET
           crebocode = excluded.crebocode,
           titel = excluded.titel,
           wervende_titel = excluded.wervende_titel,
           leerweg = excluded.leerweg,
           startdatum = excluded.startdatum,
           bedrag_van = excluded.bedrag_van,
           bedrag_tot = excluded.bedrag_tot,
           dagen_per_week = excluded.dagen_per_week,
           plaats = excluded.plaats,
           postcode = excluded.postcode,
           straat = excluded.straat,
           huisnummer = excluded.huisnummer,
           lat = excluded.lat,
           lon = excluded.lon,
           org_id = excluded.org_id,
           org_leerbedrijf_id = excluded.org_leerbedrijf_id,
           org_naam = excluded.org_naam,
           org_logo_url = excluded.org_logo_url,
           last_seen_at = excluded.last_seen_at,
           removed_at = NULL,
           raw_json = excluded.raw_json
         WHERE listings.raw_json <> excluded.raw_json
            OR listings.removed_at IS NOT NULL`,
      )
      .bind(
        l.leerplaatsId,
        l.kwalificatie?.crebocode ?? "",
        l.titel ?? "",
        l.wervendeTitel ?? null,
        l.leerweg ?? null,
        l.startdatum ?? null,
        l.bedragVan ?? 0,
        l.bedragTot ?? 0,
        l.dagenPerWeek ?? null,
        l.adres?.plaats ?? null,
        l.adres?.postcode ?? null,
        l.adres?.straat ?? null,
        l.adres?.huisnummer ?? null,
        l.adres?.coordinaten?.lat ?? null,
        l.adres?.coordinaten?.lon ?? null,
        l.organisatie?.id ?? null,
        l.organisatie?.leerbedrijfId ?? null,
        l.organisatie?.naam ?? null,
        l.organisatie?.logoUrl ?? null,
        now,
        now,
        JSON.stringify(l),
      ),
  );

  for (const group of chunk(stmts, BATCH_SIZE)) {
    await batchWithRetry(db, group);
  }
}

// Mark the given IDs removed. The caller computes which IDs are gone (active in
// the DB but absent from this sweep); we only run if the sweep completed, so a
// crashed scrape never mass-removes.
export async function markRemoved(
  db: D1Database,
  goneIds: string[],
  now: number,
): Promise<void> {
  for (const batch of chunk(goneIds, D1_PARAM_LIMIT)) {
    if (batch.length === 0) continue;
    const placeholders = batch.map(() => "?").join(",");
    await db
      .prepare(`UPDATE listings SET removed_at = ? WHERE leerplaats_id IN (${placeholders})`)
      .bind(now, ...batch)
      .run();
  }
}

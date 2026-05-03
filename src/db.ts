import type { Listing } from "./types";

// D1 caps bound parameters at 100 per statement.
const D1_PARAM_LIMIT = 90;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export interface RunStats {
  total: number;
  newIds: string[];
  removedIds: string[];
}

export async function isFirstRun(db: D1Database): Promise<boolean> {
  const row = await db
    .prepare("SELECT COUNT(*) AS c FROM scrape_runs WHERE finished_at IS NOT NULL")
    .first<{ c: number }>();
  return (row?.c ?? 0) === 0;
}

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
  notifiedCount: number,
  error: string | null,
): Promise<void> {
  await db
    .prepare(
      `UPDATE scrape_runs
         SET finished_at = ?, total_count = ?, new_count = ?,
             removed_count = ?, notified_count = ?, error = ?
       WHERE id = ?`,
    )
    .bind(finishedAt, totalCount, newCount, removedCount, notifiedCount, error, runId)
    .run();
}

// Upsert a batch of listings. Returns the IDs that were genuinely new
// (i.e. did not already exist in the table).
export async function upsertListings(
  db: D1Database,
  listings: Listing[],
  now: number,
  suppressNotification: boolean,
): Promise<string[]> {
  if (listings.length === 0) return [];

  const ids = listings.map((l) => l.leerplaatsId);
  const existingIds = new Set<string>();
  for (const batch of chunk(ids, D1_PARAM_LIMIT)) {
    const placeholders = batch.map(() => "?").join(",");
    const existing = await db
      .prepare(`SELECT leerplaats_id FROM listings WHERE leerplaats_id IN (${placeholders})`)
      .bind(...batch)
      .all<{ leerplaats_id: string }>();
    for (const r of existing.results ?? []) existingIds.add(r.leerplaats_id);
  }

  const stmts = listings.map((l) => {
    const isNew = !existingIds.has(l.leerplaatsId);
    if (isNew) {
      const notifiedAt = suppressNotification ? now : null;
      return db
        .prepare(
          `INSERT INTO listings (
             leerplaats_id, crebocode, titel, wervende_titel, leerweg, startdatum,
             bedrag_van, bedrag_tot, dagen_per_week,
             plaats, postcode, straat, huisnummer, lat, lon,
             org_id, org_leerbedrijf_id, org_naam, org_logo_url,
             first_seen_at, last_seen_at, notified_at, raw_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          notifiedAt,
          JSON.stringify(l),
        );
    }
    // Existing — refresh last_seen_at and re-clear removed_at, in case it had
    // disappeared previously and is now back.
    return db
      .prepare(
        `UPDATE listings
            SET last_seen_at = ?, removed_at = NULL, raw_json = ?
          WHERE leerplaats_id = ?`,
      )
      .bind(now, JSON.stringify(l), l.leerplaatsId);
  });

  await db.batch(stmts);

  return listings.filter((l) => !existingIds.has(l.leerplaatsId)).map((l) => l.leerplaatsId);
}

// Mark anything we previously knew about that wasn't in this scrape as removed.
// Returns the IDs that were just marked removed.
export async function markRemoved(
  db: D1Database,
  presentIds: string[],
  now: number,
): Promise<string[]> {
  // Pull all currently-active IDs and diff in JS — avoids the D1 param cap
  // entirely and keeps the query plan simple.
  const all = await db
    .prepare("SELECT leerplaats_id FROM listings WHERE removed_at IS NULL")
    .all<{ leerplaats_id: string }>();
  const present = new Set(presentIds);
  const goneIds = (all.results ?? [])
    .map((r) => r.leerplaats_id)
    .filter((id) => !present.has(id));

  if (goneIds.length === 0) return [];

  for (const batch of chunk(goneIds, D1_PARAM_LIMIT)) {
    const placeholders = batch.map(() => "?").join(",");
    await db
      .prepare(
        `UPDATE listings SET removed_at = ? WHERE leerplaats_id IN (${placeholders})`,
      )
      .bind(now, ...batch)
      .run();
  }
  return goneIds;
}

export async function fetchUnnotified(db: D1Database): Promise<Listing[]> {
  const rows = await db
    .prepare(
      `SELECT raw_json FROM listings
        WHERE notified_at IS NULL AND removed_at IS NULL
        ORDER BY first_seen_at ASC`,
    )
    .all<{ raw_json: string }>();
  return (rows.results ?? []).map((r) => JSON.parse(r.raw_json) as Listing);
}

export async function markNotified(
  db: D1Database,
  ids: string[],
  now: number,
): Promise<void> {
  if (ids.length === 0) return;
  for (const batch of chunk(ids, D1_PARAM_LIMIT)) {
    const placeholders = batch.map(() => "?").join(",");
    await db
      .prepare(`UPDATE listings SET notified_at = ? WHERE leerplaats_id IN (${placeholders})`)
      .bind(now, ...batch)
      .run();
  }
}

import type { Listing } from "./types";

// D1 caps bound parameters at 100 per statement.
const D1_PARAM_LIMIT = 90;

// Statements per db.batch() call. D1 rejects oversized batches, so a full
// 10 000-listing run is split into transactions of this size.
const BATCH_SIZE = 100;

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

// Upsert a batch of listings. Returns the IDs that were genuinely new
// (i.e. did not already exist in the table).
export async function upsertListings(
  db: D1Database,
  listings: Listing[],
  now: number,
): Promise<string[]> {
  if (listings.length === 0) return [];

  // Load known rows (id + content) once and diff in JS, so a steady-state run
  // only WRITES rows that are new, content-changed, or returning from removed.
  // At ~10k listings/tick this turns ~10k row-writes into a handful, which
  // keeps us well under D1's write quota. `last_seen_at` therefore tracks the
  // last time a listing changed, not every scrape that contained it.
  const known = await db
    .prepare("SELECT leerplaats_id, removed_at, raw_json FROM listings")
    .all<{ leerplaats_id: string; removed_at: number | null; raw_json: string }>();
  const existing = new Map((known.results ?? []).map((r) => [r.leerplaats_id, r]));

  const newIds: string[] = [];
  const stmts: D1PreparedStatement[] = [];

  for (const l of listings) {
    const raw = JSON.stringify(l);
    const prev = existing.get(l.leerplaatsId);

    if (!prev) {
      newIds.push(l.leerplaatsId);
      stmts.push(
        db
          .prepare(
            `INSERT INTO listings (
               leerplaats_id, crebocode, titel, wervende_titel, leerweg, startdatum,
               bedrag_van, bedrag_tot, dagen_per_week,
               plaats, postcode, straat, huisnummer, lat, lon,
               org_id, org_leerbedrijf_id, org_naam, org_logo_url,
               first_seen_at, last_seen_at, raw_json
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
            raw,
          ),
      );
      continue;
    }

    // Existing — only write if the content changed or it was previously
    // removed (i.e. it just came back). Unchanged active rows are left alone.
    if (prev.raw_json !== raw || prev.removed_at !== null) {
      stmts.push(
        db
          .prepare(
            `UPDATE listings
                SET last_seen_at = ?, removed_at = NULL, raw_json = ?
              WHERE leerplaats_id = ?`,
          )
          .bind(now, raw, l.leerplaatsId),
      );
    }
  }

  // Write in chunks: D1 rejects oversized batches. Each chunk is a transaction.
  for (const group of chunk(stmts, BATCH_SIZE)) {
    await db.batch(group);
  }

  return newIds;
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

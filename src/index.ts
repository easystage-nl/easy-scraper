import type { Env, SearchQuery } from "./types";
import { sweepCrebocodes } from "./stagemarkt";
import { refreshOpleidingen } from "./opleidingen";
import {
  startRun,
  finishRun,
  upsertListings,
  markRemoved,
  listCrebocodes,
  loadKnown,
} from "./db";

// In-flight studies are bounded by this so peak memory stays low: each study is
// upserted and discarded as it arrives, so we never hold the full ~140k-listing
// catalog at once (which is what OOM'd the earlier all-into-one-Map version).
const SWEEP_CONCURRENCY = 8;

function buildQuery(env: Env): SearchQuery {
  return {
    siteId: env.SITE_ID,
    niveau: env.NIVEAU,
    type: env.TYPE,
    rangeKm: env.RANGE_KM,
    crebocode: env.CREBOCODE, // ignored: the sweep overrides it per study
    plaatsPostcode: env.PLAATS_POSTCODE,
    buitenland: env.BUITENLAND,
  };
}

// Full national scrape: one upstream query per study (~540 calls total), each
// study's listings streamed straight into D1 and then dropped. A single broad
// query is capped by upstream at the 10 000 listings nearest plaatsPostcode, so
// sweeping per study is what gives complete coverage. ~140k rows on the first
// backfill, near-zero writes thereafter (the upsert only touches changed rows).
async function runScrape(env: Env): Promise<{ summary: string }> {
  const now = Math.floor(Date.now() / 1000);
  const base = buildQuery(env);
  const runId = await startRun(env.stagemarkt, now, JSON.stringify(base));

  try {
    // Refresh the crebocode→opleiding lookup first: it's the catalog we sweep
    // over, so doing it up front means new/renamed programs are picked up the
    // same run. Best-effort — a failure here must not fail the listing scrape.
    try {
      await refreshOpleidingen(env.stagemarkt, env.SITE_ID);
    } catch (e) {
      console.error("refreshOpleidingen failed:", e instanceof Error ? e.message : String(e));
    }

    const crebos = await listCrebocodes(env.stagemarkt);
    if (crebos.length === 0) {
      throw new Error("opleidingen lookup is empty; run POST /refresh-opleidingen first");
    }

    // Snapshot every id we already hold (id + removed flag only — never the
    // payloads) so we can count new vs returning and find removals without
    // loading the table into the Worker.
    const known = await loadKnown(env.stagemarkt);
    const present = new Set<string>();
    let newCount = 0;

    // Studies are fetched concurrently (network-bound), but their DB writes are
    // funnelled through one serial chain: D1 rejects with "DB is overloaded"
    // when several workers fire batches at once, so only one batch stream may be
    // in flight. Each worker awaits its own write before fetching its next
    // study, which also caps in-flight items at ~SWEEP_CONCURRENCY studies.
    let writeChain: Promise<void> = Promise.resolve();
    const { failed } = await sweepCrebocodes(
      base,
      crebos,
      SWEEP_CONCURRENCY,
      async (_crebo, items) => {
        for (const it of items) {
          const id = it.leerplaatsId;
          if (!known.has(id) && !present.has(id)) newCount++;
          present.add(id);
        }
        writeChain = writeChain.then(() => upsertListings(env.stagemarkt, items, now));
        await writeChain;
      },
    );

    // Removals only when the sweep was complete: if any study failed to fetch,
    // its listings are missing from `present` through no fault of their own, so
    // marking absentees removed would wrongly drop them. Upserts already landed;
    // removals just wait for a clean run.
    let goneIds: string[] = [];
    if (failed.length === 0) {
      for (const [id, st] of known) {
        if (!st.removed && !present.has(id)) goneIds.push(id);
      }
      await markRemoved(env.stagemarkt, goneIds, now);
    } else {
      console.warn(`skipping removals: ${failed.length} study fetch(es) failed`);
    }

    await finishRun(
      env.stagemarkt,
      runId,
      Math.floor(Date.now() / 1000),
      present.size,
      newCount,
      goneIds.length,
      failed.length ? `partial: ${failed.length} study fetch(es) failed; removals skipped` : null,
    );

    const summary =
      `studies=${crebos.length} present=${present.size} new=${newCount} ` +
      `removed=${goneIds.length} failed=${failed.length}`;
    console.log(summary);
    return { summary };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await finishRun(env.stagemarkt, runId, Math.floor(Date.now() / 1000), 0, 0, 0, msg);
    console.error("scrape failed:", msg);
    throw err;
  }
}

export default {
  // Cloudflare cron trigger
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runScrape(env)
        .then(() => undefined)
        .catch((e) => console.error("scheduled scrape failed:", e instanceof Error ? e.message : String(e))),
    );
  },

  // HTTP fetch handler — JSON API consumed by the easy-dash SPA (separate
  // origin), plus the manual /run trigger.
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // CORS: the dashboard is served from a different origin. CORS_ORIGIN is a
    // comma-separated allowlist (e.g. prod + localhost dev); we echo back the
    // request's Origin when it matches. Unset / "*" allows any origin.
    const allowed = (env.CORS_ORIGIN ?? "*").split(",").map((s) => s.trim());
    const reqOrigin = req.headers.get("Origin");
    const allowOrigin =
      allowed.includes("*")
        ? "*"
        : reqOrigin && allowed.includes(reqOrigin)
          ? reqOrigin
          : allowed[0] ?? "*";
    const cors = {
      "Access-Control-Allow-Origin": allowOrigin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      Vary: "Origin",
    };
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), {
        headers: { "Content-Type": "application/json", ...cors },
      });

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    // Trigger a full scrape now (same work the hourly cron does). Synchronous:
    // returns the run summary, so the first backfill call may take ~30-60s.
    if (url.pathname === "/run" && req.method === "POST") {
      const result = await runScrape(env);
      return json(result);
    }

    // Populate/refresh the crebocode→opleiding lookup without a full scrape.
    // Useful right after deploy so the dashboard's opleiding filter has data.
    if (url.pathname === "/refresh-opleidingen" && req.method === "POST") {
      const count = await refreshOpleidingen(env.stagemarkt, env.SITE_ID);
      return json({ opleidingen: count });
    }

    // Server-side filtered + paginated listings. Returns { items, total } so
    // the dashboard never has to pull the whole table into the browser.
    if (url.pathname === "/listings") {
      const p = url.searchParams;
      const limit = Math.min(Math.max(parseInt(p.get("limit") ?? "100", 10) || 100, 1), 500);
      const offset = Math.max(parseInt(p.get("offset") ?? "0", 10) || 0, 0);
      const status = p.get("status") ?? "active"; // active | removed | all
      const q = (p.get("q") ?? "").trim();
      const plaats = (p.get("plaats") ?? "").trim();
      const leerweg = (p.get("leerweg") ?? "").trim();
      const crebocode = (p.get("crebocode") ?? "").trim();
      const sort = p.get("sort") ?? "newest";

      // Predicates that reference the listings table only — qualify with `l.`
      // since the query joins the opleidingen lookup.
      const where: string[] = [];
      const args: unknown[] = [];
      if (status === "active") where.push("l.removed_at IS NULL");
      else if (status === "removed") where.push("l.removed_at IS NOT NULL");
      if (plaats) {
        where.push("l.plaats = ?");
        args.push(plaats);
      }
      if (leerweg) {
        where.push("l.leerweg = ?");
        args.push(leerweg);
      }
      if (crebocode) {
        where.push("l.crebocode = ?");
        args.push(crebocode);
      }
      if (q) {
        where.push("(l.titel LIKE ? OR l.wervende_titel LIKE ? OR l.org_naam LIKE ?)");
        const like = `%${q}%`;
        args.push(like, like, like);
      }
      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const orderSql =
        sort === "recent"
          ? "ORDER BY l.last_seen_at DESC"
          : sort === "title"
            ? "ORDER BY COALESCE(NULLIF(l.wervende_titel, ''), l.titel) COLLATE NOCASE ASC"
            : "ORDER BY l.first_seen_at DESC";

      const totalRow = await env.stagemarkt
        .prepare(`SELECT COUNT(*) AS c FROM listings l ${whereSql}`)
        .bind(...args)
        .first<{ c: number }>();

      const rows = await env.stagemarkt
        .prepare(
          `SELECT l.leerplaats_id, l.titel, l.wervende_titel, l.org_naam, l.org_logo_url,
                  l.plaats, l.postcode, l.leerweg, l.startdatum, l.dagen_per_week,
                  l.lat, l.lon, l.first_seen_at, l.last_seen_at, l.removed_at,
                  l.crebocode, o.label AS opleiding, o.niveaunaam
             FROM listings l
             LEFT JOIN opleidingen o ON o.crebocode = l.crebocode
             ${whereSql} ${orderSql}
             LIMIT ? OFFSET ?`,
        )
        .bind(...args, limit, offset)
        .all();

      return json({ items: rows.results ?? [], total: totalRow?.c ?? 0 });
    }

    // Unfiltered counts for the header.
    if (url.pathname === "/stats") {
      const row = await env.stagemarkt
        .prepare(
          `SELECT COUNT(*) AS total,
                  SUM(CASE WHEN removed_at IS NULL THEN 1 ELSE 0 END) AS active
             FROM listings`,
        )
        .first<{ total: number; active: number }>();
      const total = row?.total ?? 0;
      const active = row?.active ?? 0;
      return json({ total, active, removed: total - active });
    }

    // Distinct values for the filter dropdowns.
    if (url.pathname === "/facets") {
      const [plaatsen, leerwegen, opleidingen] = await Promise.all([
        env.stagemarkt
          .prepare(
            "SELECT DISTINCT plaats FROM listings WHERE plaats IS NOT NULL AND plaats <> '' ORDER BY plaats COLLATE NOCASE",
          )
          .all<{ plaats: string }>(),
        env.stagemarkt
          .prepare(
            "SELECT DISTINCT leerweg FROM listings WHERE leerweg IS NOT NULL AND leerweg <> '' ORDER BY leerweg COLLATE NOCASE",
          )
          .all<{ leerweg: string }>(),
        // Only opleidingen that actually have (active) listings, with a count so
        // the UI can show how many stages each program has.
        env.stagemarkt
          .prepare(
            `SELECT l.crebocode AS crebocode, o.label AS label, COUNT(*) AS count
               FROM listings l
               JOIN opleidingen o ON o.crebocode = l.crebocode
              WHERE l.removed_at IS NULL AND l.crebocode <> ''
              GROUP BY l.crebocode, o.label
              ORDER BY o.label COLLATE NOCASE`,
          )
          .all<{ crebocode: string; label: string; count: number }>(),
      ]);
      return json({
        plaatsen: (plaatsen.results ?? []).map((r) => r.plaats),
        leerwegen: (leerwegen.results ?? []).map((r) => r.leerweg),
        opleidingen: opleidingen.results ?? [],
      });
    }

    if (url.pathname === "/runs") {
      const rows = await env.stagemarkt.prepare(
        "SELECT * FROM scrape_runs ORDER BY started_at DESC LIMIT 50",
      ).all();
      return json(rows.results ?? []);
    }

    return new Response("not found", { status: 404, headers: cors });
  },
};

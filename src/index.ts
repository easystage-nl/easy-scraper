import type { Env, SearchQuery } from "./types";
import { searchEducations } from "./stagemarkt";
import {
  startRun,
  finishRun,
  upsertListings,
  markRemoved,
} from "./db";

function buildQuery(env: Env): SearchQuery {
  return {
    siteId: env.SITE_ID,
    niveau: env.NIVEAU,
    type: env.TYPE,
    rangeKm: env.RANGE_KM,
    crebocode: env.CREBOCODE,
    plaatsPostcode: env.PLAATS_POSTCODE,
    buitenland: env.BUITENLAND,
  };
}

async function runScrape(env: Env): Promise<{ summary: string }> {
  const now = Math.floor(Date.now() / 1000);
  const query = buildQuery(env);
  const queryJson = JSON.stringify(query);
  const runId = await startRun(env.stagemarkt, now, queryJson);

  try {
    const res = await searchEducations(query);
    const items = res.items ?? [];

    const newIds = await upsertListings(env.stagemarkt, items, now);
    const removedIds = await markRemoved(
      env.stagemarkt,
      items.map((i) => i.leerplaatsId),
      now,
    );

    await finishRun(
      env.stagemarkt,
      runId,
      Math.floor(Date.now() / 1000),
      res.totalCount,
      newIds.length,
      removedIds.length,
      null,
    );

    const summary =
      `total=${res.totalCount} new=${newIds.length} removed=${removedIds.length}`;
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
    ctx.waitUntil(runScrape(env).then(() => undefined));
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

    if (url.pathname === "/run" && req.method === "POST") {
      const result = await runScrape(env);
      return json(result);
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
      const sort = p.get("sort") ?? "newest";

      const where: string[] = [];
      const args: unknown[] = [];
      if (status === "active") where.push("removed_at IS NULL");
      else if (status === "removed") where.push("removed_at IS NOT NULL");
      if (plaats) {
        where.push("plaats = ?");
        args.push(plaats);
      }
      if (leerweg) {
        where.push("leerweg = ?");
        args.push(leerweg);
      }
      if (q) {
        where.push("(titel LIKE ? OR wervende_titel LIKE ? OR org_naam LIKE ?)");
        const like = `%${q}%`;
        args.push(like, like, like);
      }
      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const orderSql =
        sort === "recent"
          ? "ORDER BY last_seen_at DESC"
          : sort === "title"
            ? "ORDER BY COALESCE(NULLIF(wervende_titel, ''), titel) COLLATE NOCASE ASC"
            : "ORDER BY first_seen_at DESC";

      const totalRow = await env.stagemarkt
        .prepare(`SELECT COUNT(*) AS c FROM listings ${whereSql}`)
        .bind(...args)
        .first<{ c: number }>();

      const rows = await env.stagemarkt
        .prepare(
          `SELECT leerplaats_id, titel, wervende_titel, org_naam, org_logo_url,
                  plaats, postcode, leerweg, startdatum, dagen_per_week,
                  lat, lon, first_seen_at, last_seen_at, removed_at
             FROM listings ${whereSql} ${orderSql}
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
      const [plaatsen, leerwegen] = await Promise.all([
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
      ]);
      return json({
        plaatsen: (plaatsen.results ?? []).map((r) => r.plaats),
        leerwegen: (leerwegen.results ?? []).map((r) => r.leerweg),
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

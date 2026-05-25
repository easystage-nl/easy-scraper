import type { Env, SearchQuery } from "./types";
import { searchEducations } from "./stagemarkt";
import {
  isFirstRun,
  startRun,
  finishRun,
  upsertListings,
  markRemoved,
  fetchUnnotified,
  markNotified,
} from "./db";
import { postBatch, delayBetweenBatches, MAX_EMBEDS_PER_MSG } from "./discord";

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
  const firstRun = await isFirstRun(env.stagemarkt);
  const runId = await startRun(env.stagemarkt, now, queryJson);

  try {
    const res = await searchEducations(query);
    const items = res.items ?? [];

    const newIds = await upsertListings(env.stagemarkt, items, now, firstRun);
    const removedIds = await markRemoved(
      env.stagemarkt,
      items.map((i) => i.leerplaatsId),
      now,
    );

    let notifiedCount = 0;
    if (!firstRun) {
      const unnotified = await fetchUnnotified(env.stagemarkt);
      if (unnotified.length > 0 && env.DISCORD_WEBHOOK_URL) {
        const color = parseInt(env.DISCORD_COLOR, 10) || 5793266;
        for (let i = 0; i < unnotified.length; i += MAX_EMBEDS_PER_MSG) {
          const batch = unnotified.slice(i, i + MAX_EMBEDS_PER_MSG);
          await postBatch(env.DISCORD_WEBHOOK_URL, batch, color);
          // Mark this batch immediately — if a later batch 429s and throws,
          // we don't lose the work that already succeeded.
          await markNotified(
            env.stagemarkt,
            batch.map((l) => l.leerplaatsId),
            Math.floor(Date.now() / 1000),
          );
          notifiedCount += batch.length;
          if (i + MAX_EMBEDS_PER_MSG < unnotified.length) {
            await delayBetweenBatches();
          }
        }
      }
    }

    await finishRun(
      env.stagemarkt,
      runId,
      Math.floor(Date.now() / 1000),
      res.totalCount,
      newIds.length,
      removedIds.length,
      notifiedCount,
      null,
    );

    const summary =
      `total=${res.totalCount} new=${newIds.length} removed=${removedIds.length} ` +
      `notified=${notifiedCount} firstRun=${firstRun}`;
    console.log(summary);
    return { summary };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await finishRun(env.stagemarkt, runId, Math.floor(Date.now() / 1000), 0, 0, 0, 0, msg);
    console.error("scrape failed:", msg);
    throw err;
  }
}

export default {
  // Cloudflare cron trigger
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runScrape(env).then(() => undefined));
  },

  // HTTP fetch handler — manual trigger / debug / future viz endpoints.
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/run" && req.method === "POST") {
      const result = await runScrape(env);
      return Response.json(result);
    }

    if (url.pathname === "/listings") {
      const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "1000", 10), 5000);
      const onlyActive = url.searchParams.get("active") !== "false";
      const where = onlyActive ? "WHERE removed_at IS NULL" : "";
      const rows = await env.stagemarkt.prepare(
        `SELECT leerplaats_id, titel, wervende_titel, org_naam, org_logo_url,
                plaats, postcode, leerweg, startdatum, dagen_per_week,
                lat, lon, first_seen_at, last_seen_at, removed_at
           FROM listings ${where}
           ORDER BY first_seen_at DESC
           LIMIT ?`,
      )
        .bind(limit)
        .all();
      return Response.json(rows.results ?? []);
    }

    if (url.pathname === "/runs") {
      const rows = await env.stagemarkt.prepare(
        "SELECT * FROM scrape_runs ORDER BY started_at DESC LIMIT 50",
      ).all();
      return Response.json(rows.results ?? []);
    }

    return new Response("not found", { status: 404 });
  },
};

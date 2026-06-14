import type { Listing, SearchQuery, SearchResponse } from "./types";

const BASE = "https://stagemarkt.nl/api/query-hub";

const PAGE_SIZE = 1000;

// Upstream caps deep pagination at 10 000 results: page 11 (pageSize 1000)
// returns an empty list. So a single broad query (e.g. no crebocode = all
// studies) surfaces at most 10 000 of the geographically-nearest listings.
const MAX_PAGES = 10;

// Per-request timeout + retries. Without a timeout a single hung upstream
// connection stalls the whole sweep until the Worker is hard-killed (which
// skips finishRun/markRemoved entirely), so this guard is load-bearing.
const REQUEST_TIMEOUT_MS = 20_000;
const FETCH_ATTEMPTS = 3;

// Fetch one page of education-search. Empty filters (crebocode/niveau) are
// omitted so the upstream treats them as "any". Times out and retries a few
// times on transient failures before giving up.
async function fetchPage(q: SearchQuery, page: number): Promise<SearchResponse> {
  const url = new URL(`${BASE}/education-search`);
  url.searchParams.set("siteId", q.siteId);
  url.searchParams.set("pageSize", String(PAGE_SIZE));
  url.searchParams.set("page", String(page));
  url.searchParams.set("type", q.type);
  url.searchParams.set("range", q.rangeKm);
  url.searchParams.set("plaatsPostcode", q.plaatsPostcode);
  url.searchParams.set("buitenlandseBedrijven", q.buitenland);
  if (q.niveau) url.searchParams.set("niveau", q.niveau);
  if (q.crebocode) url.searchParams.set("crebocode", q.crebocode);

  let lastErr: unknown;
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url.toString(), {
        headers: {
          accept: "application/json",
          "user-agent": "easy-stage-scraper/0.1 (+https://github.com/vasie1337/easy-stage)",
          referer: "https://stagemarkt.nl/",
        },
        cf: { cacheTtl: 0, cacheEverything: false },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        throw new Error(`stagemarkt education-search ${res.status}: ${await res.text()}`);
      }
      return (await res.json()) as SearchResponse;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`stagemarkt education-search failed: ${String(lastErr)}`);
}

// Walk pages until every listing the query exposes is collected (or the
// 10 000-result cap is hit). Dedupes by leerplaatsId in case pages overlap.
export async function searchEducations(q: SearchQuery): Promise<SearchResponse> {
  const byId = new Map<string, Listing>();
  let totalCount = 0;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetchPage(q, page);
    totalCount = res.totalCount;
    const items = res.items ?? [];
    if (items.length === 0) break;
    for (const item of items) byId.set(item.leerplaatsId, item);
    if (page >= res.totalPages) break;
  }

  const items = [...byId.values()];
  return { totalCount, totalPages: Math.ceil(totalCount / PAGE_SIZE), pageNumber: 1, items };
}

// Scrape a set of studies, one upstream query per crebocode, with bounded
// concurrency. Each study's listings are handed to `onStudy` and then dropped,
// so the caller can persist incrementally without ever holding the full
// national set (~140k listings) in memory.
//
// A single broad query (crebocode = "") is capped by upstream at the 10 000
// listings geographically nearest plaatsPostcode, silently dropping any study
// with listings outside that radius. Querying per crebocode keeps every study
// under its own sub-10 000 cap, so the union of all studies is complete.
export async function sweepCrebocodes(
  base: SearchQuery,
  crebocodes: string[],
  concurrency: number,
  onStudy: (crebocode: string, items: Listing[]) => Promise<void>,
): Promise<{ failed: string[] }> {
  let cursor = 0;
  const failed: string[] = [];

  // Simple worker-pool: each worker pulls the next crebocode until exhausted.
  // One study's failure is isolated so it can't abort the whole sweep — but it
  // is reported so the caller can skip removals (an unfetched study must not be
  // treated as "all its listings are gone").
  async function worker(): Promise<void> {
    while (cursor < crebocodes.length) {
      const crebocode = crebocodes[cursor++];
      if (!crebocode) continue;
      try {
        const res = await searchEducations({ ...base, crebocode });
        await onStudy(crebocode, res.items ?? []);
      } catch (e) {
        console.error(`study ${crebocode} failed:`, e instanceof Error ? e.message : String(e));
        failed.push(crebocode);
      }
    }
  }

  const pool = Math.min(Math.max(concurrency, 1), crebocodes.length);
  await Promise.all(Array.from({ length: pool }, () => worker()));
  return { failed };
}

export function listingUrl(leerplaatsId: string, titel: string | undefined | null): string {
  const slug = slugify(titel ?? "");
  return slug
    ? `https://stagemarkt.nl/stages/${slug}_${leerplaatsId}`
    : `https://stagemarkt.nl/stages/${leerplaatsId}`;
}

function slugify(s: string): string {
  return s
    .normalize("NFKD")             // strip accents (é → e + ́)
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")   // any non-alphanum → hyphen
    .replace(/^-+|-+$/g, "");      // trim leading/trailing hyphens
}

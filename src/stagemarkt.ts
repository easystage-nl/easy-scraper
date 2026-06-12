import type { Listing, SearchQuery, SearchResponse } from "./types";

const BASE = "https://stagemarkt.nl/api/query-hub";

const PAGE_SIZE = 1000;

// Upstream caps deep pagination at 10 000 results: page 11 (pageSize 1000)
// returns an empty list. So a single broad query (e.g. no crebocode = all
// studies) surfaces at most 10 000 of the geographically-nearest listings.
const MAX_PAGES = 10;

// Fetch one page of education-search. Empty filters (crebocode/niveau) are
// omitted so the upstream treats them as "any".
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

  const res = await fetch(url.toString(), {
    headers: {
      accept: "application/json",
      "user-agent": "easy-stage-scraper/0.1 (+https://github.com/vasie1337/easy-stage)",
      referer: "https://stagemarkt.nl/",
    },
    cf: { cacheTtl: 0, cacheEverything: false },
  });

  if (!res.ok) {
    throw new Error(`stagemarkt education-search ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as SearchResponse;
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

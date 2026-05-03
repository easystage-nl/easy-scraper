import type { SearchQuery, SearchResponse } from "./types";

const BASE = "https://stagemarkt.nl/api/query-hub";

// pageSize accepts >=1000 and the upstream caps at totalCount, so one call
// covers any realistic query. Re-paginate only if you ever set a search that
// could return >1000 items.
const PAGE_SIZE = 1000;

export async function searchEducations(q: SearchQuery): Promise<SearchResponse> {
  const url = new URL(`${BASE}/education-search`);
  url.searchParams.set("siteId", q.siteId);
  url.searchParams.set("pageSize", String(PAGE_SIZE));
  url.searchParams.set("page", "1");
  url.searchParams.set("niveau", q.niveau);
  url.searchParams.set("type", q.type);
  url.searchParams.set("range", q.rangeKm);
  url.searchParams.set("crebocode", q.crebocode);
  url.searchParams.set("plaatsPostcode", q.plaatsPostcode);
  url.searchParams.set("buitenlandseBedrijven", q.buitenland);

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

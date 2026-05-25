export interface Listing {
  leerplaats_id: string;
  titel: string;
  wervende_titel: string | null;
  org_naam: string | null;
  org_logo_url: string | null;
  plaats: string | null;
  postcode: string | null;
  leerweg: string | null;
  startdatum: string | null;
  dagen_per_week: string | null;
  lat: number | null;
  lon: number | null;
  first_seen_at: number;
  last_seen_at: number;
  removed_at: number | null;
}

export interface ScrapeRun {
  id: number;
  started_at: number;
  finished_at: number | null;
  total_count: number | null;
  new_count: number | null;
  removed_count: number | null;
  notified_count: number | null;
  error: string | null;
}

export async function fetchListings(): Promise<Listing[]> {
  const res = await fetch("/listings?limit=1000&active=false");
  if (!res.ok) throw new Error(`/listings ${res.status}`);
  return res.json();
}

export async function fetchRuns(): Promise<ScrapeRun[]> {
  const res = await fetch("/runs");
  if (!res.ok) throw new Error(`/runs ${res.status}`);
  return res.json();
}

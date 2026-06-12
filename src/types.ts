export interface Env {
  stagemarkt: D1Database;

  SITE_ID: string;
  NIVEAU: string;
  TYPE: string;
  RANGE_KM: string;
  CREBOCODE: string;
  PLAATS_POSTCODE: string;
  BUITENLAND: string;
  DISCORD_COLOR: string;

  // Optional: restrict CORS to the dashboard origin. Defaults to "*".
  CORS_ORIGIN?: string;

  DISCORD_WEBHOOK_URL: string;
}

export interface SearchQuery {
  siteId: string;
  niveau: string;
  type: string;
  rangeKm: string;
  crebocode: string;
  plaatsPostcode: string;
  buitenland: string;
}

export interface Listing {
  titel: string;
  wervendeTitel: string;
  leerplaatsId: string;
  leerweg: string;
  startdatum: string;
  bedragVan: number;
  bedragTot: number;
  dagenPerWeek: string;
  adres: {
    huisnummer: string;
    plaats: string;
    postcode: string;
    straat: string;
    coordinaten: { lat: number; lon: number };
  };
  kwalificatie: { niveaunaam: string; crebocode: string };
  organisatie: {
    id: string;
    leerbedrijfId: string;
    naam: string;
    logoUrl: string | null;
  };
  afbeeldingen: Array<{ opslagId: string; volgnummer: number; url: string }>;
}

export interface SearchResponse {
  totalCount: number;
  totalPages: number;
  pageNumber: number;
  items: Listing[];
}

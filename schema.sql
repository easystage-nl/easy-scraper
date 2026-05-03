-- Listings discovered by the scraper. One row per leerplaatsId.
-- raw_json keeps the full upstream payload for forward-compat / future viz.
CREATE TABLE IF NOT EXISTS listings (
  leerplaats_id      TEXT PRIMARY KEY,
  crebocode          TEXT NOT NULL,
  titel              TEXT NOT NULL,
  wervende_titel     TEXT,
  leerweg            TEXT,
  startdatum         TEXT,
  bedrag_van         INTEGER,
  bedrag_tot         INTEGER,
  dagen_per_week     TEXT,

  plaats             TEXT,
  postcode           TEXT,
  straat             TEXT,
  huisnummer         TEXT,
  lat                REAL,
  lon                REAL,

  org_id             TEXT,
  org_leerbedrijf_id TEXT,
  org_naam           TEXT,
  org_logo_url       TEXT,

  first_seen_at      INTEGER NOT NULL,   -- unix sec, first time we saw it
  last_seen_at       INTEGER NOT NULL,   -- last scrape that contained it
  removed_at         INTEGER,            -- nulled until it disappears
  notified_at        INTEGER,            -- when Discord was pinged (NULL = first run / suppressed)

  raw_json           TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_listings_first_seen ON listings(first_seen_at);
CREATE INDEX IF NOT EXISTS idx_listings_crebocode  ON listings(crebocode);
CREATE INDEX IF NOT EXISTS idx_listings_plaats     ON listings(plaats);
CREATE INDEX IF NOT EXISTS idx_listings_active     ON listings(removed_at) WHERE removed_at IS NULL;

-- One row per scrape execution. Used for the "is this the first run?" check
-- (so we don't flood Discord on initial deploy) and as a basis for later viz.
CREATE TABLE IF NOT EXISTS scrape_runs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at      INTEGER NOT NULL,
  finished_at     INTEGER,
  query_params    TEXT NOT NULL,
  total_count     INTEGER,
  new_count       INTEGER,
  removed_count   INTEGER,
  notified_count  INTEGER,
  error           TEXT
);

CREATE INDEX IF NOT EXISTS idx_runs_started ON scrape_runs(started_at);

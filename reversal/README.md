# Reversal of stagemarkt.nl

Reverse engineered from `stagemarkt.nl.har` — capture of a single search session
(crebo `25998` "Software developer", postcode `7231 CM` Warnsveld, niveau 4,
range 10 → 75 km).

---

## 1. Overview

Stagemarkt.nl is a public-facing search frontend over an internal API hosted at
`https://stagemarkt.nl/api/query-hub/*`. The API:

- is **unauthenticated** — no cookies, bearer tokens, CSRF headers, or signed
  query parameters are sent on any of the 14 captured requests
- requires only the `siteId=STAGEMARKT` query parameter as a tenant marker
- is served behind Azure Front Door (`x-azure-ref`, `x-cache: TCP_HIT`) with
  CDN caching: `cache-control: public, max-age=0, s-maxage=600,
  stale-while-revalidate=1800` — responses are cached at the edge for 10 min
- returns Brotli-compressed JSON (`content-type: application/json`,
  `content-encoding: br`)
- enforces same-origin via standard `Referer: https://stagemarkt.nl/` and CORS
  (`sec-fetch-site: same-origin`), but does not validate either server-side
  in any way visible from the trace

Two response envelopes are used:

- **Suggestion endpoints** (`opleiding-suggesties`, `locatie-suggesties`)
  wrap data: `{"status":200,"body":{"data": ...}}`
- **Search endpoints** (`education-search`, `organization-search`) return the
  data shape directly: `{totalCount, totalPages, pageNumber, items, filters}`

This inconsistency is a strong hint that two backend services sit behind
`/api/query-hub/`.

---

## 2. Endpoints

All endpoints are `GET` on `https://stagemarkt.nl/api/query-hub/`.

### 2.1 `opleiding-suggesties` — autocomplete for studies (crebo lookup)

```
GET /api/query-hub/opleiding-suggesties
    ?siteId=STAGEMARKT
    &niveau=4
    &term=<query or empty>
    &pageSize=<int>
```

| Param      | Required | Notes                                                      |
|------------|----------|------------------------------------------------------------|
| `siteId`   | yes      | Always `STAGEMARKT`                                        |
| `niveau`   | yes      | MBO level (1–4); always `4` in capture                     |
| `term`     | yes      | Free-text query. Bare `&term` (no value) returns all 187  |
| `pageSize` | yes      | `1000` for full list, `1` when resolving a single crebo    |

**Behaviour observed:**
- `term` matches against `label`, `equivalenten[]`, and `synoniemen[]` of each
  qualification — `term=software` returns crebo `25998` "Software developer"
  because `Software development` appears in `equivalenten`
- `term=25998` (a crebo code) also returns the same item, so the field is
  **also** matched against `creboCode`. The frontend uses this to round-trip
  a crebo from the URL back to a display label
- empty `term` returns the entire niveau-4 catalog (187 items in capture)

**Response (truncated):**

```json
{
  "status": 200,
  "body": {
    "data": {
      "hasNextPage": false,
      "hasPreviousPage": false,
      "pageNumber": 1,
      "totalCount": 187,
      "totalPages": 1,
      "items": [
        {
          "creboCode": 25998,
          "label": "Software developer",
          "value": "Software developer (25998)",
          "equivalenten": ["Applicatieontwikkeling", "Software development", ...],
          "synoniemen": []
        }
      ]
    }
  }
}
```

`value` is `"<label> (<creboCode>)"` — the literal string the autocomplete
input shows after selection.

### 2.2 `locatie-suggesties` — autocomplete for cities/postcodes

```
GET /api/query-hub/locatie-suggesties
    ?siteId=STAGEMARKT
    &term=<query>
```

`term` accepts both **postcodes** (`7231cm` — case-insensitive, spaces
optional) and **city names** (`Warnsveld`). The `type` field in the response
disambiguates:

```json
{
  "status": 200,
  "body": {
    "data": [
      {
        "suggestie": "Warnsveld",
        "type": "Plaats",
        "plaats": {
          "gemeente": null,
          "regio": "dec506ce-03ca-e211-a270-001372415b01",
          "lat": 52.13581411,
          "lon": 6.27204951,
          "naam": "Warnsveld",
          "postcode": "7231",
          "provincie": null
        }
      }
    ]
  }
}
```

`type` ∈ `{"Postcode", "Plaats"}` (others likely exist for `Gemeente`,
`Provincie`, `Regio`). When the user selects a suggestion the frontend uses
`plaats.naam` as the value of `plaatsPostcode` in the search call.

### 2.3 `education-search` — main internship/leerplaats search

```
GET /api/query-hub/education-search
    ?siteId=STAGEMARKT
    &pageSize=12
    &niveau=4
    &type=1
    &range=10                       # km radius around plaatsPostcode
    &crebocode=25998
    &plaatsPostcode=Warnsveld       # output of locatie-suggesties
    &buitenlandseBedrijven=false    # include foreign companies
```

| Param                  | Notes                                                        |
|------------------------|--------------------------------------------------------------|
| `pageSize`             | `12` in UI; pagination via `page` (not seen but implied)     |
| `niveau`               | MBO level 1–4                                                |
| `type`                 | `1` — likely "leerplaats" vs other listing types             |
| `range`                | km radius. Capture shows `10` and `75`                       |
| `crebocode`            | Numeric crebo from suggestion endpoint                       |
| `plaatsPostcode`       | City name **or** postcode; same parameter for both           |
| `buitenlandseBedrijven`| `true` to include companies outside NL                       |

**Response shape:**

```json
{
  "totalCount": 120,
  "totalPages": 10,
  "pageNumber": 1,
  "filters": [
    { "id": "kenmerken",  "options": [{"hits":31, "id":"...", "label":"..."}] },
    { "id": "sectoren",   "options": [...] },
    { "id": "sbi",        "options": [...] },
    { "id": "leerwegen",  "options": [{"hits":112, "id":"...", "label":"BOL"}] }
  ],
  "items": [
    {
      "titel": "Software developer",
      "wervendeTitel": "Enthousiaste applicatie- en mediaontwikkelaar...",
      "leerplaatsId": "fd22a7fd-e159-4026-9409-1388eade0a9c-25998",
      "afstand": null,
      "vergoedingen": [
        {"id":"a0c0cc96-...","omschrijving":"Reiskostenvergoeding"},
        {"id":"ac16dd77-...","omschrijving":"Onkostenvergoeding"}
      ],
      "bedragVan": 0,
      "bedragTot": 0,
      "adres": {
        "huisnummer": "8", "plaats": "Almere", "postcode": "1333 LC",
        "straat": "Bouwmeesterweg",
        "coordinaten": { "lat": 52.39949479, "lon": 5.26054525 }
      },
      "leerweg": "BOL",
      "startdatum": "2026-05-01T00:00:00.000Z",
      "kenmerken": [],
      "kwalificatie": { "niveaunaam": "Niveau 4", "crebocode": "25998" },
      "organisatie": {
        "id": "9394e9de-ab1b-11d4-94b6-009027dcdf20",
        "leerbedrijfId": "100077736",
        "naam": "Genetics B.V.",
        "logoUrl": "https://cdn-sbborganisatielogoscacheprod.azureedge.net/.../logo.png",
        "vestigingsadres": { "...": "..." }
      },
      "afbeeldingen": [
        {
          "opslagId": "3412600b-...png",
          "volgnummer": 1,
          "url": "https://cdn-sbbleerplaatsafbeeldingenprod.azureedge.net/.../...png"
        }
      ],
      "gewijzigdDatum": null,
      "dagenPerWeek": ""
    }
  ]
}
```

Notes:
- `leerplaatsId` has the form `<uuid>-<crebocode>` — the pair is the natural
  key of an internship listing
- `afstand` (distance from query location) is `null` in capture; probably
  populated when a postcode is supplied instead of a city
- `filters` is a faceted-search payload: each filter dimension lists every
  option with its `hits` count for the current result set. The frontend
  renders these as filter sidebar checkboxes
- assets are served from two Azure CDN buckets:
  - `cdn-sbborganisatielogoscacheprod.azureedge.net` — organisation logos
  - `cdn-sbbleerplaatsafbeeldingenprod.azureedge.net` — listing photos

### 2.4 `organization-search` — accredited training companies

```
GET /api/query-hub/organization-search
    ?siteId=STAGEMARKT
    &pageSize=2
    &page=1
    &organization                     # bare flag, no value
    &sort=BPVO_REGISTRATIES
    &direction=DESCENDING
    &aantalLeerplaatsen=0             # 0 = include companies with no open spots
    &plaatsPostcode=Warnsveld
    &range=10
    &crebocode=25998
```

| Param                | Notes                                                       |
|----------------------|-------------------------------------------------------------|
| `pageSize`           | `2` here — used as a sidebar widget on the search page      |
| `page`               | 1-indexed                                                   |
| `organization`       | Bare flag (no `=value`). Probably toggles "search by org"   |
| `sort`               | `BPVO_REGISTRATIES` — order by # of registered placements   |
| `direction`          | `ASCENDING` or `DESCENDING`                                 |
| `aantalLeerplaatsen` | Min open-spots filter; `0` = include all                    |
| `plaatsPostcode`, `range`, `crebocode` | Same semantics as education-search       |

**Response:**

```json
{
  "hasNextPage": true,
  "hasPreviousPage": false,
  "pageNumber": 1,
  "totalCount": 10,
  "totalPages": 5,
  "items": [
    {
      "id": "c70b91f9-d015-4c57-ab56-c8be1a1a174a",
      "leerbedrijfId": "100349458",
      "naam": "Qlip B.V.",
      "website": "http://www.qlip.nl",
      "telefoonnummer": "+31887547000",
      "email": "hr@qlip.nl",
      "logoUrl": "https://cdn-sbborganisatielogoscacheprod.azureedge.net/.../logo.png",
      "bedrijfsgrootte": "251 tot en met 500 medewerkers",
      "leidenVaakOp": true,
      "aantalLeerplaatsen": 0,
      "afstand": null,
      "kenmerken": [],
      "vestigingsadres": {
        "coordinaten": {"lat": 52.15697524, "lon": 6.20644733},
        "plaats": "Zutphen", "postcode": "7202 CM",
        "straat": "Oostzeestraat", "huisnummer": "2a", "extra": "",
        "land": {"code":"NL","id":"e883076c-...","name":"Nederland"}
      }
    }
  ],
  "filters": [
    {"id": "sbi",            "options": [...]},
    {"id": "bedrijfsgrootte","options": [...]},
    {"id": "kenmerken",      "options": [...]},
    {"id": "sectoren",       "options": [...]},
    {"id": "landen",         "options": [...]}
  ]
}
```

Notable: contact details (`email`, `telefoonnummer`, `website`) are returned
inline — no detail-page fetch needed for an org row.

---

## 3. End-to-end flow

Reconstructed from the 14 entries:

| # | Endpoint              | Trigger                                               |
|---|-----------------------|-------------------------------------------------------|
| 0 | opleiding-suggesties  | Page mount: prefetch all 187 niveau-4 studies         |
| 1 | opleiding-suggesties  | User types `software` in study autocomplete           |
| 2 | opleiding-suggesties  | User clears the term (re-fetch full list)             |
| 3 | locatie-suggesties    | User types postcode `7231cm`                          |
| 4 | education-search      | Submit search (crebo 25998, Warnsveld, range 10)      |
| 5 | locatie-suggesties    | Re-resolve `Warnsveld` for the result-page header     |
| 6 | opleiding-suggesties  | Re-resolve crebo `25998` to display "Software dev."   |
| 7 | organization-search   | Sidebar: top training companies for this query        |
| 8 | locatie-suggesties    | (duplicate, likely a React effect double-fire)        |
| 9 | education-search      | User changes radius slider 10 → 75 km                 |
|10 | locatie-suggesties    | (duplicate)                                           |
|11 | opleiding-suggesties  | (duplicate)                                           |
|12 | organization-search   | Sidebar refresh for new radius                        |
|13 | locatie-suggesties    | (duplicate)                                           |

Inferred sequence:

1. **Mount**: prefetch full studies catalog (`opleiding-suggesties` empty term).
2. **Input**: as the user types in either autocomplete, the relevant
   suggestion endpoint is queried per keystroke (no client-side debounce
   visible — `software` was sent as one query, so a debounce *did* fire).
3. **Submit**: navigate to `/stages?...` (URL not in HAR but implied) carrying
   `crebocode`, `plaatsPostcode`, `range`, `niveau`. The result page then:
   - re-fetches `locatie-suggesties` and `opleiding-suggesties?pageSize=1`
     to hydrate the search-bar labels from the URL params
   - calls `education-search` for the listing grid
   - calls `organization-search` for the "leerbedrijven" sidebar
4. **Filter change**: any filter/range mutation re-runs steps from `education-search` onward. The same trio is re-issued on every change.

---

## 4. Replicating the flow

Minimal `curl` reproduction (no headers required beyond `accept`):

```bash
# Resolve "software" → crebo 25998
curl -s 'https://stagemarkt.nl/api/query-hub/opleiding-suggesties?siteId=STAGEMARKT&niveau=4&term=software&pageSize=1000'

# Resolve postcode → city
curl -s 'https://stagemarkt.nl/api/query-hub/locatie-suggesties?siteId=STAGEMARKT&term=7231cm'

# Run the search
curl -s 'https://stagemarkt.nl/api/query-hub/education-search?siteId=STAGEMARKT&pageSize=12&niveau=4&type=1&range=10&crebocode=25998&plaatsPostcode=Warnsveld&buitenlandseBedrijven=false'

# Adjacent companies
curl -s 'https://stagemarkt.nl/api/query-hub/organization-search?siteId=STAGEMARKT&pageSize=2&page=1&organization&sort=BPVO_REGISTRATIES&direction=DESCENDING&aantalLeerplaatsen=0&plaatsPostcode=Warnsveld&range=10&crebocode=25998'
```

No auth, no cookies, no signed params. Throughput is bounded by Front Door
edge-caching — repeated identical queries get `x-cache: TCP_HIT`.

---

## 5. Open questions / not in capture

- **Pagination** — `page` parameter is shown only on `organization-search`.
  `education-search` likely accepts the same; not exercised in this trace.
- **Other filters** — `filters[]` in responses lists `sectoren`, `sbi`,
  `leerwegen`, `kenmerken`, `bedrijfsgrootte`, `landen`. The corresponding
  request-side parameter names aren't in the capture (probably `sectorId`,
  `sbiId`, `leerwegId`, `kenmerkId`, etc., taking the option `id` UUIDs).
- **`type` parameter** — only `type=1` seen on `education-search`. Other
  values likely exist (e.g. for "praktijkverklaring" listings).
- **Detail endpoints** — no `GET /education/{leerplaatsId}` or
  `/organization/{id}` calls in the trace; user did not click into a result.
- **Rate limits** — none triggered, none exposed via headers.

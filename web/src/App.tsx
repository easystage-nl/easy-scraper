import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Header } from "./components/Header";
import { Filters, type FilterState } from "./components/Filters";
import { ListingCard } from "./components/ListingCard";
import { ViewToggle, type ViewMode } from "./components/ViewToggle";
import { fetchListings, fetchRuns, type Listing, type ScrapeRun } from "./lib/api";

// Leaflet ships ~150kB of JS + CSS. Only load it when the map tab is opened.
const MapView = lazy(() =>
  import("./components/MapView").then((m) => ({ default: m.MapView })),
);

const DEFAULT_FILTERS: FilterState = {
  search: "",
  plaats: "",
  leerweg: "",
  status: "active",
  sort: "newest",
};

export function App() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [runs, setRuns] = useState<ScrapeRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [view, setView] = useState<ViewMode>("list");
  const [now, setNow] = useState(Date.now());

  async function load(isInitial: boolean) {
    if (isInitial) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const [l, r] = await Promise.all([fetchListings(), fetchRuns()]);
      setListings(l);
      setRuns(r);
      setNow(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void load(true);
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(tick);
  }, []);

  const plaatsen = useMemo(
    () =>
      [...new Set(listings.map((l) => l.plaats).filter((p): p is string => !!p))].sort(
        (a, b) => a.localeCompare(b),
      ),
    [listings],
  );
  const leerwegen = useMemo(
    () =>
      [...new Set(listings.map((l) => l.leerweg).filter((l): l is string => !!l))].sort(
        (a, b) => a.localeCompare(b),
      ),
    [listings],
  );

  const totalActive = useMemo(() => listings.filter((l) => !l.removed_at).length, [listings]);

  const filtered = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    let out = listings.filter((l) => {
      if (filters.status === "active" && l.removed_at) return false;
      if (filters.status === "removed" && !l.removed_at) return false;
      if (filters.plaats && l.plaats !== filters.plaats) return false;
      if (filters.leerweg && l.leerweg !== filters.leerweg) return false;
      if (q) {
        const hay =
          (l.titel ?? "") + " " + (l.wervende_titel ?? "") + " " + (l.org_naam ?? "");
        if (!hay.toLowerCase().includes(q)) return false;
      }
      return true;
    });
    out = [...out].sort((a, b) => {
      switch (filters.sort) {
        case "newest":
          return b.first_seen_at - a.first_seen_at;
        case "recent":
          return b.last_seen_at - a.last_seen_at;
        case "title":
          return (a.wervende_titel || a.titel).localeCompare(b.wervende_titel || b.titel);
      }
    });
    return out;
  }, [listings, filters]);

  const latestRun = runs.find((r) => r.finished_at) ?? runs[0] ?? null;

  return (
    <div className="min-h-screen">
      <Header
        totalActive={totalActive}
        totalAll={listings.length}
        latestRun={latestRun}
        onRefresh={() => void load(false)}
        refreshing={refreshing}
      />

      <Filters
        state={filters}
        onChange={setFilters}
        plaatsen={plaatsen}
        leerwegen={leerwegen}
        resultCount={filtered.length}
        rightSlot={<ViewToggle value={view} onChange={setView} />}
      />

      <main className="mx-auto max-w-6xl px-4 pb-16 pt-4 sm:px-6">
        {loading ? (
          <SkeletonGrid />
        ) : error ? (
          <EmptyState title="Couldn't load listings" body={error} />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No listings match"
            body="Try clearing some filters or widening your search."
          />
        ) : view === "map" ? (
          <Suspense
            fallback={
              <div className="h-[480px] animate-pulse rounded-xl border border-[var(--border)] bg-[var(--accent)]/50" />
            }
          >
            <MapView listings={filtered} />
          </Suspense>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((l) => (
              <ListingCard key={l.leerplaats_id} l={l} now={now} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 9 }).map((_, i) => (
        <div
          key={i}
          className="h-44 animate-pulse rounded-xl border border-[var(--border)] bg-[var(--accent)]/50"
        />
      ))}
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--border)] p-12 text-center">
      <p className="text-sm font-medium text-[var(--fg)]">{title}</p>
      <p className="mt-1 text-xs text-[var(--muted)]">{body}</p>
    </div>
  );
}

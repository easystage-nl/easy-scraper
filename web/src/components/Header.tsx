import type { ScrapeRun } from "../lib/api";
import { relativeTime } from "../lib/utils";

export function Header({
  totalActive,
  totalAll,
  latestRun,
  onRefresh,
  refreshing,
}: {
  totalActive: number;
  totalAll: number;
  latestRun: ScrapeRun | null;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const lastFinished = latestRun?.finished_at ?? null;
  return (
    <header className="border-b border-[var(--border)] bg-[var(--bg)]/80 backdrop-blur sticky top-0 z-10">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-semibold tracking-tight">easy-stage</h1>
          <span className="hidden text-sm text-[var(--muted)] sm:inline">
            live stagemarkt.nl listings
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-[var(--muted)]">
          <span>
            <span className="font-medium text-[var(--fg)]">{totalActive}</span> active ·{" "}
            <span>{totalAll} total</span>
          </span>
          <span className="hidden sm:inline">·</span>
          <span className="hidden sm:inline">
            last scrape {relativeTime(lastFinished)}
          </span>
          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="rounded-md border border-[var(--border)] bg-[var(--card)] px-2.5 py-1 text-xs font-medium text-[var(--fg)] transition-colors hover:bg-[var(--accent)] disabled:opacity-50"
          >
            {refreshing ? "…" : "Refresh"}
          </button>
        </div>
      </div>
    </header>
  );
}

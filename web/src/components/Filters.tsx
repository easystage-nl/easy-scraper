import type { ReactNode } from "react";
import { Input, Select } from "./ui";

export type SortKey = "newest" | "recent" | "title";

export interface FilterState {
  search: string;
  plaats: string;
  leerweg: string;
  status: "active" | "removed" | "all";
  sort: SortKey;
}

export function Filters({
  state,
  onChange,
  plaatsen,
  leerwegen,
  resultCount,
  rightSlot,
}: {
  state: FilterState;
  onChange: (next: FilterState) => void;
  plaatsen: string[];
  leerwegen: string[];
  resultCount: number;
  rightSlot?: ReactNode;
}) {
  const update = (patch: Partial<FilterState>) => onChange({ ...state, ...patch });

  return (
    <div className="mx-auto max-w-6xl px-4 pt-6 pb-2 sm:px-6">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr]">
        <Input
          type="search"
          placeholder="Search title, organisation…"
          value={state.search}
          onChange={(e) => update({ search: e.target.value })}
        />
        <Select value={state.plaats} onChange={(e) => update({ plaats: e.target.value })}>
          <option value="">All cities</option>
          {plaatsen.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </Select>
        <Select value={state.leerweg} onChange={(e) => update({ leerweg: e.target.value })}>
          <option value="">All leerwegen</option>
          {leerwegen.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </Select>
        <Select
          value={state.status}
          onChange={(e) => update({ status: e.target.value as FilterState["status"] })}
        >
          <option value="active">Active only</option>
          <option value="removed">Removed only</option>
          <option value="all">All</option>
        </Select>
        <Select
          value={state.sort}
          onChange={(e) => update({ sort: e.target.value as SortKey })}
        >
          <option value="newest">Newest first</option>
          <option value="recent">Recently active</option>
          <option value="title">Title (A–Z)</option>
        </Select>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 text-xs text-[var(--muted)]">
        <div className="flex items-center gap-3">
          <span>
            {resultCount} {resultCount === 1 ? "listing" : "listings"}
          </span>
          {(state.search || state.plaats || state.leerweg || state.status !== "active") && (
            <button
              onClick={() =>
                onChange({
                  search: "",
                  plaats: "",
                  leerweg: "",
                  status: "active",
                  sort: state.sort,
                })
              }
              className="text-[var(--fg)] underline-offset-2 hover:underline"
            >
              Reset filters
            </button>
          )}
        </div>
        {rightSlot}
      </div>
    </div>
  );
}

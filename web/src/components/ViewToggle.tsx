import { cn } from "../lib/utils";

export type ViewMode = "list" | "map";

export function ViewToggle({
  value,
  onChange,
}: {
  value: ViewMode;
  onChange: (v: ViewMode) => void;
}) {
  return (
    <div
      role="tablist"
      className="inline-flex rounded-md border border-[var(--border)] bg-[var(--card)] p-0.5 text-xs"
    >
      {(["list", "map"] as const).map((m) => (
        <button
          key={m}
          role="tab"
          aria-selected={value === m}
          onClick={() => onChange(m)}
          className={cn(
            "rounded px-3 py-1 font-medium capitalize transition-colors",
            value === m
              ? "bg-[var(--accent)] text-[var(--fg)]"
              : "text-[var(--muted)] hover:text-[var(--fg)]",
          )}
        >
          {m}
        </button>
      ))}
    </div>
  );
}

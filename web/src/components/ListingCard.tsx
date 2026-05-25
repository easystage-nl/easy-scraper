import type { Listing } from "../lib/api";
import { Badge, Card } from "./ui";
import { formatDate, listingUrl, relativeTime } from "../lib/utils";

const NEW_WINDOW_SEC = 24 * 60 * 60;

export function ListingCard({ l, now }: { l: Listing; now: number }) {
  const title = l.wervende_titel?.trim() || l.titel || "(no title)";
  const url = listingUrl(l.leerplaats_id, l.titel);
  const isNew = now / 1000 - l.first_seen_at < NEW_WINDOW_SEC;
  const isRemoved = !!l.removed_at;

  return (
    <Card as="a" href={url}>
      <div className="flex items-start gap-3">
        {l.org_logo_url ? (
          <img
            src={l.org_logo_url}
            alt=""
            loading="lazy"
            className="h-10 w-10 shrink-0 rounded-md border border-[var(--border)] bg-white object-contain p-1"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div className="h-10 w-10 shrink-0 rounded-md border border-[var(--border)] bg-[var(--accent)]" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="line-clamp-2 text-sm font-medium leading-snug text-[var(--fg)]">
              {title}
            </h3>
            {isNew && !isRemoved && <Badge variant="new">New</Badge>}
            {isRemoved && <Badge variant="muted">Removed</Badge>}
          </div>
          <p className="mt-0.5 truncate text-xs text-[var(--muted)]">
            {l.org_naam ?? "Unknown org"}
            {l.plaats ? ` · ${l.plaats}` : ""}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {l.leerweg && <Badge>{l.leerweg}</Badge>}
        {l.dagen_per_week && <Badge>{l.dagen_per_week} dagen/wk</Badge>}
        {l.startdatum && <Badge variant="muted">start {formatDate(l.startdatum)}</Badge>}
      </div>

      <div className="mt-3 flex items-center justify-between text-[11px] text-[var(--muted)]">
        <span>first seen {relativeTime(l.first_seen_at, now)}</span>
        {isRemoved ? (
          <span>removed {relativeTime(l.removed_at, now)}</span>
        ) : (
          <span>seen {relativeTime(l.last_seen_at, now)}</span>
        )}
      </div>
    </Card>
  );
}

import { useEffect, useMemo } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import "leaflet/dist/leaflet.css";
import type { Listing } from "../lib/api";
import { listingUrl } from "../lib/utils";

// Vite bundles these as URLs; without this Leaflet's built-in icon path
// points at /marker-icon.png which doesn't exist in production.
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

// Netherlands centroid; used when nothing is plottable yet.
const NL_CENTER: [number, number] = [52.1326, 5.2913];

interface Plottable extends Listing {
  lat: number;
  lon: number;
}

function isPlottable(l: Listing): l is Plottable {
  return typeof l.lat === "number" && typeof l.lon === "number";
}

function FitBounds({ points }: { points: Plottable[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      const p = points[0]!;
      map.setView([p.lat, p.lon], 12);
      return;
    }
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lon] as [number, number]));
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
  }, [points, map]);
  return null;
}

export function MapView({ listings }: { listings: Listing[] }) {
  const points = useMemo(() => listings.filter(isPlottable), [listings]);
  const skipped = listings.length - points.length;

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border)]">
      <MapContainer
        center={NL_CENTER}
        zoom={7}
        scrollWheelZoom
        style={{ height: "calc(100vh - 240px)", minHeight: "480px", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds points={points} />
        {points.map((p) => (
          <Marker key={p.leerplaats_id} position={[p.lat, p.lon]}>
            <Popup>
              <div className="text-sm">
                <a
                  href={listingUrl(p.leerplaats_id, p.titel)}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="font-medium text-blue-600 underline-offset-2 hover:underline"
                >
                  {p.wervende_titel?.trim() || p.titel || "(no title)"}
                </a>
                <div className="mt-1 text-xs text-neutral-600">
                  {p.org_naam ?? "Unknown org"}
                  {p.plaats ? ` · ${p.plaats}` : ""}
                </div>
                {(p.leerweg || p.dagen_per_week) && (
                  <div className="mt-1 text-xs text-neutral-500">
                    {p.leerweg ?? ""}
                    {p.leerweg && p.dagen_per_week ? " · " : ""}
                    {p.dagen_per_week ? `${p.dagen_per_week} dagen/wk` : ""}
                  </div>
                )}
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
      {skipped > 0 && (
        <div className="border-t border-[var(--border)] bg-[var(--accent)] px-3 py-1.5 text-[11px] text-[var(--muted)]">
          {skipped} listing{skipped === 1 ? "" : "s"} hidden (no coordinates)
        </div>
      )}
    </div>
  );
}

"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import { directionsUrl, type LatLon, type Station } from "../lib/stations";

// A popup built from DOM nodes, never HTML strings: station names come from
// OpenStreetMap and must not be able to inject markup.
function popupFor(station: Station) {
  const box = document.createElement("div");
  box.className = "charger-popup";
  const name = document.createElement("strong");
  name.textContent = station.name;
  const details = document.createElement("span");
  details.textContent = [`${station.distanceKm.toFixed(1)} km`, station.connectors.join(", ") || null, station.open24h ? "Open 24/7" : null].filter(Boolean).join(" · ");
  const link = document.createElement("a");
  link.href = directionsUrl(station);
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "Directions";
  box.append(name, details, link);
  return box;
}

// OpenStreetMap tiles via Leaflet, loaded only in the browser. You are a blue
// dot (or the city centre, without location); chargers are green dots.
export function ChargerMap({ origin, stations, nearYou }: { origin: LatLon; stations: Station[]; nearYou: boolean }) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let map: import("leaflet").Map | null = null;
    import("leaflet").then((L) => {
      if (cancelled || !container.current) return;
      const primary = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim() || "#0d631b";
      map = L.map(container.current, { scrollWheelZoom: false }).setView([origin.lat, origin.lon], 13);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
      L.circleMarker([origin.lat, origin.lon], { radius: 8, color: "#ffffff", weight: 3, fillColor: "#1a73e8", fillOpacity: 1 })
        .addTo(map).bindPopup(nearYou ? "You (within about 1 km)" : "City centre");
      for (const station of stations) {
        L.circleMarker([station.lat, station.lon], { radius: 9, color: "#ffffff", weight: 2, fillColor: primary, fillOpacity: 0.95 }).addTo(map).bindPopup(popupFor(station));
      }
      // Frame you and the nearest few chargers.
      const nearest = stations.slice(0, 6).map((station) => [station.lat, station.lon] as [number, number]);
      if (nearest.length) map.fitBounds(L.latLngBounds([[origin.lat, origin.lon], ...nearest]), { padding: [28, 28], maxZoom: 15 });
    });
    return () => { cancelled = true; map?.remove(); };
  }, [origin.lat, origin.lon, stations, nearYou]);

  return <div ref={container} className="charger-map" role="region" aria-label="Map of nearby chargers"/>;
}

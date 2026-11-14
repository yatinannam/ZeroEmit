"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import { directionsUrl, type LatLon, type Station } from "../lib/stations";

// A popup built from DOM nodes, never HTML strings: station names come from
// OpenStreetMap and must not be able to inject markup.
function popupFor(station: Station, number: number) {
  const box = document.createElement("div");
  box.className = "charger-popup";
  const name = document.createElement("strong");
  name.textContent = `${number}. ${station.name}`;
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
// dot (or the city centre, without location); chargers are green pins
// numbered like the list below the map.
export function ChargerMap({ origin, stations, nearYou }: { origin: LatLon; stations: Station[]; nearYou: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  // The map is made once per origin, and a filter chip only swaps the pins
  // on `pins`, so the tiles, zoom and pan stay put. Tagged with its origin,
  // so pins never land on the map of an earlier one.
  const origins = `${origin.lat},${origin.lon},${nearYou}`;
  const [view, setView] = useState<{ origins: string; L: typeof import("leaflet"); map: import("leaflet").Map; pins: import("leaflet").LayerGroup } | null>(null);
  const current = view?.origins === origins ? view : null;
  const framed = useRef<import("leaflet").Map | null>(null);

  useEffect(() => {
    let cancelled = false;
    let map: import("leaflet").Map | null = null;
    import("leaflet").then((L) => {
      if (cancelled || !container.current) return;
      // On phones a one-finger swipe scrolls the page rather than getting
      // stuck panning the map; two fingers (or the +/- buttons) move it.
      const leaflet = L.map(container.current, { scrollWheelZoom: false, dragging: !L.Browser.mobile });
      map = leaflet;
      leaflet.attributionControl.setPrefix(false); // keep the required OSM credit, drop Leaflet's own
      // Layers wait for the map's first view (set below with the pins), so no tiles load before it.
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(leaflet);
      L.circleMarker([origin.lat, origin.lon], { radius: 8, color: "#ffffff", weight: 3, fillColor: "#1a73e8", fillOpacity: 1 })
        .addTo(leaflet).bindPopup(nearYou ? "You (approximate location)" : "City centre");
      setView({ origins, L, map: leaflet, pins: L.layerGroup().addTo(leaflet) });
    });
    return () => { cancelled = true; map?.remove(); };
  }, [origins, origin.lat, origin.lon, nearYou]);

  useEffect(() => {
    if (!current) return;
    const { L, map, pins } = current;
    pins.clearLayers();
    // The pin's text is only its number, never OSM text, so it's safe as HTML.
    stations.forEach((station, index) => {
      const icon = L.divIcon({ className: "charger-pin", html: String(index + 1), iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -12] });
      L.marker([station.lat, station.lon], { icon, title: `${index + 1}. ${station.name}` }).addTo(pins).bindPopup(popupFor(station, index + 1));
    });
    // Framed once per map (a new origin makes a new map), so filtering keeps
    // the zoom and pan. Start framed on you and the nearest few chargers:
    // opening at one zoom and then fitting would download two sets of tiles.
    if (framed.current === map) return;
    framed.current = map;
    const nearest = stations.slice(0, 6).map((station) => [station.lat, station.lon] as [number, number]);
    if (nearest.length) map.fitBounds(L.latLngBounds([[origin.lat, origin.lon], ...nearest]), { padding: [28, 28], maxZoom: 15, animate: false });
    else map.setView([origin.lat, origin.lon], 13);
  }, [current, stations, origin.lat, origin.lon]);

  return <div ref={container} className="charger-map" role="region" aria-label="Map of nearby chargers"/>;
}

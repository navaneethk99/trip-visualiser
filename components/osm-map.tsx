"use client";

import { useEffect, useMemo } from "react";
import L from "leaflet";
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";

type ResolvedStop = {
  id: string;
  displayName: string;
  latitude: number;
  longitude: number;
};

type JourneyLeg = {
  id: string;
  fromStopId: string;
  toStopId: string;
};

type Props = {
  stops: ResolvedStop[];
  legs: JourneyLeg[];
  theme: "light" | "dark";
};

const stopIcon = L.divIcon({
  className: "map-stop-icon",
  html: '<span class="map-stop-dot"></span>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

const activeIcon = L.divIcon({
  className: "map-stop-icon map-stop-icon-active",
  html: '<span class="map-stop-dot map-stop-dot-active"></span>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

export default function OsmMap({ stops, legs, theme }: Props) {
  const isDark = theme === "dark";
  const bounds = useMemo(() => {
    if (stops.length === 0) {
      return null;
    }

    return L.latLngBounds(
      stops.map((stop) => [stop.latitude, stop.longitude] as [number, number]),
    );
  }, [stops]);

  return (
    <div
      className={`h-[420px] overflow-hidden rounded-[24px] border ${
        isDark ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"
      }`}
    >
      <MapContainer
        center={[20, 0]}
        zoom={2}
        scrollWheelZoom={false}
        touchZoom
        className="h-full w-full"
        zoomControl={false}
      >
        <TileLayer
          attribution={
            isDark
              ? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; CARTO'
              : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          }
          url={
            isDark
              ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          }
        />

        <FitBounds bounds={bounds} />

        {legs.map((leg, index) => {
          const from = stops.find((stop) => stop.id === leg.fromStopId);
          const to = stops.find((stop) => stop.id === leg.toStopId);

          if (!from || !to) {
            return null;
          }

          return (
            <Polyline
              key={leg.id}
              positions={[
                [from.latitude, from.longitude],
                [to.latitude, to.longitude],
              ]}
              pathOptions={{
                color: isDark ? "#5eead4" : "#0f766e",
                opacity: Math.max(0.35, 0.85 - index * 0.08),
                weight: 4,
              }}
            />
          );
        })}

        {stops.map((stop, index) => (
          <Marker
            key={stop.id}
            position={[stop.latitude, stop.longitude]}
            icon={index === 0 || index === stops.length - 1 ? activeIcon : stopIcon}
          >
            <Tooltip direction="top" offset={[0, -10]}>
              <div className="text-sm font-medium text-slate-900">
                {index + 1}. {stop.displayName}
              </div>
            </Tooltip>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}

function FitBounds({
  bounds,
}: {
  bounds: L.LatLngBounds | null;
}) {
  const map = useMap();

  useEffect(() => {
    if (!bounds) {
      return;
    }

    map.fitBounds(bounds, {
      padding: [36, 36],
      maxZoom: bounds.isValid() && bounds.getNorthEast().equals(bounds.getSouthWest()) ? 8 : 5,
    });
  }, [bounds, map]);

  return null;
}

import type { LayerSpecification, SourceSpecification, StyleSpecification } from "maplibre-gl";

const EMPTY_COLLECTION = { type: "FeatureCollection" as const, features: [] };

export const MEMORY_CITY_SOURCES: Record<string, SourceSpecification> = {
  basemap: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, maxzoom: 19, attribution: "&copy; OpenStreetMap contributors" },
  memorymap: { type: "vector", tiles: ["/api/map-tiles/{z}/{x}/{y}"], minzoom: 0, maxzoom: 14, attribution: "&copy; OpenStreetMap contributors" },
};

export const MEMORY_CITY_LAYERS: LayerSpecification[] = [
  { id: "paper", type: "background", paint: { "background-color": "#e8e6dc" } },
  { id: "basemap", type: "raster", source: "basemap", paint: { "raster-opacity": 0.48, "raster-saturation": -0.68, "raster-contrast": -0.16, "raster-brightness-min": 0.22, "raster-brightness-max": 0.98 } },
  { id: "parks", type: "fill", source: "memorymap", "source-layer": "land", filter: ["in", ["get", "kind"], ["literal", ["park", "forest", "grass", "garden", "recreation_ground"]]], paint: { "fill-color": "#aec2aa", "fill-opacity": 0.62 } },
  { id: "water", type: "fill", source: "memorymap", "source-layer": "water_polygons", paint: { "fill-color": "#aebfc0", "fill-opacity": 0.9 } },
  { id: "roads-casing", type: "line", source: "memorymap", "source-layer": "streets", filter: ["!=", ["get", "tunnel"], true], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#cfcbc0", "line-width": ["interpolate", ["exponential", 1.35], ["zoom"], 11, 1.2, 15, 6, 18, 17], "line-opacity": 0.86 } },
  { id: "roads", type: "line", source: "memorymap", "source-layer": "streets", filter: ["!=", ["get", "tunnel"], true], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["match", ["get", "kind"], ["motorway", "trunk", "primary"], "#d8c3a2", "#f5f1e8"], "line-width": ["interpolate", ["exponential", 1.35], ["zoom"], 11, 0.7, 15, 3.8, 18, 12], "line-opacity": 0.96 } },
  { id: "building-footprints", type: "fill", source: "memorymap", "source-layer": "buildings", minzoom: 12, paint: { "fill-color": "#d5d2c8", "fill-outline-color": "#c5c2b9", "fill-opacity": ["interpolate", ["linear"], ["zoom"], 12, 0.2, 15, 0.76] } },
  { id: "buildings-3d", type: "fill-extrusion", source: "memorymap", "source-layer": "buildings", minzoom: 13.2, paint: { "fill-extrusion-color": ["interpolate", ["linear"], ["coalesce", ["get", "height"], 12], 0, "#d9d8d0", 30, "#c7cec7", 100, "#aebdb4"], "fill-extrusion-height": ["coalesce", ["get", "height"], ["*", ["get", "levels"], 3.2], 12], "fill-extrusion-base": ["coalesce", ["get", "min_height"], 0], "fill-extrusion-opacity": 0.84, "fill-extrusion-vertical-gradient": true } },
];

export function emptyGeoJsonSource(lineMetrics = false): SourceSpecification {
  return { type: "geojson", data: EMPTY_COLLECTION, lineMetrics, tolerance: 0 };
}

export function memoryCityStyle(extra?: {
  sources?: Record<string, SourceSpecification>;
  layers?: LayerSpecification[];
}): StyleSpecification {
  return {
    version: 8,
    sources: {
      ...MEMORY_CITY_SOURCES,
      ...extra?.sources,
    },
    layers: [
      ...MEMORY_CITY_LAYERS,
      ...(extra?.layers ?? []),
    ],
  };
}

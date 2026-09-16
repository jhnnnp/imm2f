import type { Place } from "../types/place";

function coverVariant(value: string) {
  let hash = 0;
  for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash % 6;
}

function monogram(name: string) {
  const compact = name.replace(/[^\p{L}\p{N}]/gu, "");
  return compact.slice(0, 2).toUpperCase() || "OU";
}

export function PlaceGraphicCover({ place }: { place: Pick<Place, "name" | "category" | "categoryLabel" | "district" | "address"> }) {
  const variant = coverVariant(`${place.name}-${place.district || place.address || ""}`);
  return (
    <span className={`place-graphic-cover is-${place.category} variant-${variant}`} aria-hidden="true">
      <i className="place-graphic-shape shape-one" />
      <i className="place-graphic-shape shape-two" />
      <span className="place-graphic-grid" />
      <span className="place-graphic-copy">
        <b>{monogram(place.name)}</b>
        <small>{place.categoryLabel} · ONLY US</small>
      </span>
    </span>
  );
}

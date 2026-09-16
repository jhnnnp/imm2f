import type { Place } from "../types/place";

function coverVariant(value: string) {
  let hash = 0;
  for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash % 6;
}

function coverTitle(name: string) {
  const title = name.trim() || "ONLY US";
  const length = title.replace(/\s/gu, "").length;
  const size = length <= 8 ? "short" : length <= 16 ? "medium" : "long";
  return { title, size };
}

export function PlaceGraphicCover({ place }: { place: Pick<Place, "name" | "category" | "categoryLabel" | "district" | "address"> }) {
  const variant = coverVariant(`${place.name}-${place.district || place.address || ""}`);
  const title = coverTitle(place.name);
  return (
    <span className={`place-graphic-cover is-${place.category} variant-${variant}`} aria-hidden="true">
      <i className="place-graphic-shape shape-one" />
      <i className="place-graphic-shape shape-two" />
      <span className="place-graphic-grid" />
      <span className="place-graphic-copy">
        <b className={`is-${title.size}`}>{title.title}</b>
        <small>{place.categoryLabel} · ONLY US</small>
      </span>
    </span>
  );
}

import { PLACE_AREA_GROUPS, regionByQuery, type PlaceArea } from "./config/regions";
import { distanceMeters } from "./geo";

/** Provider searches cover South Korea. Empty, swapped and zero coordinates
 * must not become apparently routable places. */
export function validKoreanVenueCoordinates(coordinates: [number, number]) {
  const [lng, lat] = coordinates;
  return Number.isFinite(lng) && Number.isFinite(lat) && lng >= 124 && lng <= 132 && lat >= 32 && lat <= 40;
}

const compact = (value: string) => value.normalize("NFKC").replace(/\s/g, "");
const provinceToken = (value: string) => value.replace(/(?:특별자치도|특별자치시|특별시|광역시|도|시)$/, "");
const regionalWords = (value: string) => value.replace(/주변까지|근처|주변|인근|부근|일대|근방/g, " ")
  .split(/[\s·,/]+/).filter(Boolean);

/** Resolve the UI's aliases as well as a city-qualified neighborhood. Prefer
 * the neighborhood over its parent province ("서울 성수" must stay local). */
export function resolvePlaceRegion(query: string | undefined): PlaceArea | undefined {
  const direct = regionByQuery(query);
  if (direct) return direct;
  const text = compact(query ?? "");
  if (!text) return undefined;
  const qualifier = PLACE_AREA_GROUPS.find(group => regionalWords(query ?? "").some(token =>
    provinceToken(token) === group.query || token.startsWith(group.query)));
  const allowedCodes = qualifier ? new Set([qualifier.areaCode, ...qualifier.areas.map(area => area.areaCode)]) : null;
  for (const group of PLACE_AREA_GROUPS) {
    for (const area of group.areas) {
      if (allowedCodes && !allowedCodes.has(area.areaCode)) continue;
      const aliases = [area.query, ...area.label.split("/"), ...area.query.split(/\s+/)];
      if (aliases.some(alias => alias.length >= 2 && text.includes(compact(alias)))) return area;
    }
  }
  return PLACE_AREA_GROUPS.map(group => regionByQuery(group.query)).find(region => region && text.includes(region.query));
}

type LocatedVenue = { address: string; roadAddress?: string; district?: string; coordinates: [number, number] };

/** An empty local result is safer than silently returning another city's
 * branch. Administrative tokens and known neighborhood coordinates are hard
 * geography checks; arbitrary station/venue names remain provider keywords. */
export function matchesPlaceRegion(venue: LocatedVenue, query: string | undefined) {
  const requested = query?.trim();
  if (!requested) return true;
  const address = `${venue.address} ${venue.roadAddress ?? ""} ${venue.district ?? ""}`;
  const normalizeAdministrative = (value: string) => compact(value)
    .replace(/(서울|부산|대구|인천|대전|울산|세종)(?:특별자치시|특별시|광역시|시)/g, "$1")
    .replace(/광주광역시/g, "광주");
  const administrative = requested.split(/\s+/).filter(token => /(?:구|군|시)$/.test(token));
  if (administrative.some(token => !normalizeAdministrative(address).includes(normalizeAdministrative(token)))) return false;
  const localityTokens = regionalWords(requested);
  const matchesToken = (token: string) => {
    const value = provinceToken(token);
    if (value === "충청") return /충청|충북|충남|대전|세종/.test(address);
    if (value === "전라") return /전라|전북|전남|광주/.test(address);
    if (value === "경상") return /경상|경북|경남|대구|울산|부산/.test(address);
    return normalizeAdministrative(address).includes(normalizeAdministrative(token));
  };
  // UI aliases such as 양평/양양 share a map center with a neighboring city.
  // The provider's actual address is stronger evidence than that coarse center.
  if (localityTokens.length && localityTokens.every(matchesToken)) return true;
  const known = resolvePlaceRegion(requested);
  if (known?.radius) {
    const radius = Math.max(known.radius * (/근처|주변|인근|부근/.test(requested) ? 3 : 2), 4000);
    return distanceMeters(known.coordinates, venue.coordinates) <= radius;
  }
  // Province-only requests do not have a useful radius. Check their official
  // address aliases instead of limiting a whole province around its capital.
  if (known && !known.radius) {
    const group = PLACE_AREA_GROUPS.find(item => item.query === known.query);
    if (group && localityTokens.length === 1) return matchesToken(localityTokens[0]);
  }
  // Custom localities have no reliable center. Require their address rather
  // than accepting a nationally ranked keyword result. The planner can perform
  // a separate coordinate search after resolving an exact local anchor.
  return false;
}

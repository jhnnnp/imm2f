import type { DiscoverCandidate } from "@/features/places/types/place";
import { distanceMeters } from "@/features/places/geo";
import { dateCandidateKey } from "./dateCourse";

const compact = (value: string) => value.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
const addressKey = (value: string) => compact(value).replace(/(서울|부산|대구|인천|광주|대전|울산|세종)(?:특별자치시|특별시|광역시)/g, "$1");
const phoneKey = (value: string) => value.replace(/\D/g, "");

/** Two source IDs are not two experiences. Never match by name or proximity alone. */
export function sameVenueBranch(left: DiscoverCandidate, right: DiscoverCandidate) {
  if (dateCandidateKey(left) === dateCandidateKey(right)) return true;
  if (!left.name || !right.name || !Array.isArray(left.coordinates) || !Array.isArray(right.coordinates)
    || left.coordinates.length !== 2 || right.coordinates.length !== 2
    || !left.coordinates.every(Number.isFinite) || !right.coordinates.every(Number.isFinite)) return false;
  if (left.category !== right.category || compact(left.name) !== compact(right.name)
    || distanceMeters(left.coordinates, right.coordinates) > 80) return false;
  const addresses = [left.address, left.roadAddress].filter(Boolean).map(addressKey);
  const addressMatches = [right.address, right.roadAddress].some(address => address && addresses.includes(addressKey(address)));
  const phone = phoneKey(left.phone || "");
  return addressMatches || phone.length >= 8 && phone === phoneKey(right.phone || "");
}

function combineFacts(primary: DiscoverCandidate, secondary: DiscoverCandidate): DiscoverCandidate {
  const primaryId = dateCandidateKey(primary);
  const facts = [primary, secondary].flatMap(candidate => (candidate.evidence ?? [])
    .filter(fact => !fact.venueId || fact.venueId === dateCandidateKey(candidate))
    .map(fact => ({ ...fact, venueId: primaryId })));
  // Public fields and their source travel together; a menu cannot borrow the
  // other provider's URL merely because the two records refer to one branch.
  const menu = primary.dishes ? primary : secondary.dishes ? secondary : primary;
  return { ...primary,
    openingHours: primary.openingHours || secondary.openingHours,
    phone: primary.phone || secondary.phone, image: primary.image || secondary.image,
    dishes: menu.dishes, factSourceUrl: menu.factSourceUrl || primary.factSourceUrl,
    evidence: [...new Map(facts.map(fact => [`${fact.url}:${fact.text}`, fact])).values()],
    performanceEvent: primary.performanceEvent ?? secondary.performanceEvent,
  };
}

/** Keep selected IDs stable; otherwise retain the richer current provider record. */
export function deduplicateVenueBranches(candidates: DiscoverCandidate[], preserveIds: readonly string[] = []) {
  const selected = new Set(preserveIds);
  const score = (candidate: DiscoverCandidate) => Number(Boolean(candidate.dishes)) * 3
    + (candidate.evidence ?? []).filter(fact => fact.verification === "source_checked").length * 2
    + Number(Boolean(candidate.openingHours));
  const result: DiscoverCandidate[] = [];
  for (const candidate of candidates) {
    const index = result.findIndex(other => sameVenueBranch(other, candidate));
    if (index < 0) { result.push(candidate); continue; }
    const previous = result[index];
    // Both explicitly selected identities must reach feasibility validation;
    // silently deleting one would break the user's selection contract.
    if (selected.has(dateCandidateKey(previous)) && selected.has(dateCandidateKey(candidate))
      && dateCandidateKey(previous) !== dateCandidateKey(candidate)) { result.push(candidate); continue; }
    const preferIncoming = selected.has(dateCandidateKey(candidate))
      || !selected.has(dateCandidateKey(previous)) && score(candidate) > score(previous);
    result[index] = preferIncoming ? combineFacts(candidate, previous) : combineFacts(previous, candidate);
  }
  return result;
}

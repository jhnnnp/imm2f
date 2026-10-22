import type { AIPlannerState } from "@/features/planning/types/plan";
import type { DiscoverCandidate, Place } from "@/features/places/types/place";
import type { TasteBoard, TasteProfile } from "@/features/taste/types";
import { dateCandidateKey } from "./dateCourse";
import { sameVenueBranch } from "./venueIdentity";

type MemberTaste = Pick<TasteProfile, "activities" | "cuisines" | "avoidFoods" | "setting" | "crowd" | "dateFlow" | "drink" | "pace" | "note">;
export type CouplePersonalizationContext = {
  you: MemberTaste | null;
  partner: MemberTaste | null;
  shared: { activities: TasteProfile["activities"]; cuisines: TasteProfile["cuisines"];
    crowd: TasteProfile["crowd"] | null; setting: TasteProfile["setting"] | null;
    dateFlow: TasteProfile["dateFlow"] | null };
  differences: Array<{ topic: string; you: string; partner: string }>;
  savedFeedback: { preferredIds: string[]; bothWantIds: string[]; avoidedIds: string[]; visitedIds: string[] };
};

const positive = new Set(["want", "must_visit", "revisit"]);
const negative = new Set(["dislike", "not_interested"]);
const compact = (value: string) => value.normalize("NFKC").replace(/\s/g, "").toLowerCase();
function providerId(place: Place) {
  return place.externalSource && place.externalSource !== "manual" && place.externalPlaceId
    ? `${place.externalSource}:${place.externalPlaceId}` : null;
}
function member(profile: TasteProfile | null): MemberTaste | null {
  return profile ? { activities: profile.activities.slice(0, 8), cuisines: profile.cuisines.slice(0, 5),
    avoidFoods: profile.avoidFoods.slice(0, 12), setting: profile.setting, crowd: profile.crowd,
    dateFlow: profile.dateFlow, drink: profile.drink, pace: profile.pace, note: profile.note.slice(0, 200) } : null;
}

/** Keep both people's choices visible instead of reducing one partner to an area list. */
export function buildCouplePersonalization(taste: TasteBoard, saved: Place[] = []): CouplePersonalizationContext {
  const you = member(taste.you);
  const partner = member(taste.partner);
  const shared = <T>(a: T[] | undefined, b: T[] | undefined): T[] => a && b
    ? a.filter(value => b.includes(value)) : [...(a ?? b ?? [])];
  const same = <K extends "crowd" | "setting" | "dateFlow">(key: K): TasteProfile[K] | null =>
    you && partner ? you[key] === partner[key] ? you[key] : null : you?.[key] ?? partner?.[key] ?? null;
  const ids = (accept: (place: Place) => boolean) => saved.filter(accept).flatMap(place => {
    const id = providerId(place); return id ? [id] : [];
  }).slice(0, 40);
  return { you, partner,
    shared: { activities: shared(you?.activities, partner?.activities),
      cuisines: shared(you?.cuisines, partner?.cuisines).filter(cuisine => cuisine !== "any"),
      crowd: same("crowd"), setting: same("setting"), dateFlow: same("dateFlow") },
    differences: (taste.compare?.differences ?? []).slice(0, 6).map(({ topic, you, partner }) => ({
      topic: topic.slice(0, 60), you: you.slice(0, 120), partner: partner.slice(0, 120) })),
    savedFeedback: {
      preferredIds: ids(place => !negative.has(place.userStatus) && !negative.has(place.partnerStatus)
        && (positive.has(place.userStatus) || positive.has(place.partnerStatus))),
      bothWantIds: ids(place => positive.has(place.userStatus) && positive.has(place.partnerStatus)),
      avoidedIds: ids(place => negative.has(place.userStatus) || negative.has(place.partnerStatus)),
      visitedIds: ids(place => place.userStatus === "visited" || place.partnerStatus === "visited"),
    },
  };
}

/** Current-turn interpretation already established preferences and wins over profiles. */
export function applyCouplePersonalization(state: AIPlannerState, context: CouplePersonalizationContext): AIPlannerState {
  return { ...state,
    preferences: { ...(state.preferences ?? { vibe: [] }),
      crowdTolerance: state.preferences?.crowdTolerance ?? (context.shared.crowd === "quiet" ? 0.25
        : context.shared.crowd === "lively" ? 0.8 : undefined) },
    memorySuggestions: { activities: state.memorySuggestions?.activities.length
      ? state.memorySuggestions.activities : context.shared.activities,
      cuisine: state.memorySuggestions?.cuisine ?? (context.shared.cuisines.length === 1 ? context.shared.cuisines[0] : null) },
  };
}

function sameVenue(candidate: DiscoverCandidate, place: Place) {
  const id = providerId(place);
  if (id) {
    if (id === dateCandidateKey(candidate)) return true;
    // Within one provider the entity ID is authoritative. Across providers,
    // require the same branch's name, address and coordinates before sharing feedback.
    if (place.externalSource === candidate.externalSource || !place.coordinates) return false;
    return sameVenueBranch(candidate, { ...candidate, externalSource: place.externalSource === "tourapi" ? "tourapi" : "kakao",
      externalPlaceId: place.externalPlaceId!, name: place.name, category: place.category,
      address: place.address || "", roadAddress: place.roadAddress || "", phone: place.phone || "",
      coordinates: place.coordinates });
  }
  return compact(candidate.name) === compact(place.name) && Boolean(place.roadAddress || place.address)
    && [candidate.roadAddress, candidate.address].some(address => address
      && compact(address) === compact(place.roadAddress || place.address || ""));
}

/** A dislike applies to its exact branch. An explicit current visit request can override it. */
export function allowsCoupleVenue(candidate: DiscoverCandidate, saved: Place[], state: AIPlannerState,
  selectedIds: readonly string[] = []) {
  if (selectedIds.includes(dateCandidateKey(candidate)) || state.requiredPlaces.some(name => compact(name) === compact(candidate.name))) return true;
  return !saved.some(place => sameVenue(candidate, place)
    && (negative.has(place.userStatus) || negative.has(place.partnerStatus)));
}

export function coupleVenueAffinity(candidate: DiscoverCandidate, saved: Place[]) {
  const matches = saved.filter(place => sameVenue(candidate, place));
  if (matches.some(place => negative.has(place.userStatus) || negative.has(place.partnerStatus))) return -40;
  const match = matches.find(place => positive.has(place.userStatus) && positive.has(place.partnerStatus))
    ?? matches.find(place => positive.has(place.userStatus) || positive.has(place.partnerStatus)) ?? matches[0];
  if (!match) return 0;
  if (negative.has(match.userStatus) || negative.has(match.partnerStatus)) return -40;
  const count = Number(positive.has(match.userStatus)) + Number(positive.has(match.partnerStatus));
  return count === 2 ? 16 : count ? 8 : match.userStatus === "visited" || match.partnerStatus === "visited" ? -5 : 0;
}

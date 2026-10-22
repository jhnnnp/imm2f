import { expect, it } from "vitest";
import type { Place, DiscoverCandidate } from "@/features/places/types/place";
import type { TasteBoard, TasteProfile } from "@/features/taste/types";
import { emptyDateBrief } from "./dateBrief";
import { allowsCoupleVenue, applyCouplePersonalization, buildCouplePersonalization, coupleVenueAffinity } from "./couplePersonalization";

const profile: TasteProfile = { areas: ["성수"], pace: "mixed", activities: ["meal", "cafe"], cuisines: ["양식"],
  avoidFoods: [], setting: "indoor", crowd: "quiet", timeWindow: "any", areaScope: "nearby", dateFlow: "flex", drink: "none", indoorPlay: "", note: "" };
const board: TasteBoard = { you: profile, partner: { ...profile, activities: ["walk", "cafe"] },
  youName: "나", partnerName: "상대", partnerConnected: true, compare: null };
const candidate: DiscoverCandidate = { externalSource: "kakao", externalPlaceId: "branch1", name: "같은 이름 카페",
  category: "cafe", categoryLabel: "카페", district: "성수", address: "서울 성동구 성수이로 10", roadAddress: "",
  phone: "", mapUrl: "", coordinates: [127.05, 37.54] };
const saved: Place = { ...candidate, id: "saved", coordinates: candidate.coordinates, description: "", durationMinutes: 60,
  expectedCostTwo: null, visualTone: "photo", userStatus: "want", partnerStatus: "dislike", userFit: 0, partnerFit: 0 };

it("retains both members and shared taste without inventing agreement", () => {
  const context = buildCouplePersonalization(board, [saved]);
  expect(context.shared).toMatchObject({ activities: ["cafe"], cuisines: ["양식"], crowd: "quiet", setting: "indoor" });
  expect(context.you?.activities).toEqual(["meal", "cafe"]);
  expect(context.partner?.activities).toEqual(["walk", "cafe"]);
  expect(context.savedFeedback).toMatchObject({ avoidedIds: ["kakao:branch1"], preferredIds: [] });
  expect(buildCouplePersonalization({ ...board, partner: { ...profile, crowd: "lively" } }).shared.crowd).toBeNull();
});

it("preserves this turn's preferences and keeps saved hints soft and destination-free", () => {
  const context = buildCouplePersonalization(board);
  const state = applyCouplePersonalization(emptyDateBrief(), context);
  expect(state.areas).toEqual([]);
  expect(state.activities).toEqual([]);
  expect(state.cuisine).toBeNull();
  expect(state.memorySuggestions).toEqual({ activities: ["cafe"], cuisine: "양식" });
  expect(applyCouplePersonalization({ ...emptyDateBrief(), preferences: { vibe: ["활기찬"], crowdTolerance: 0.9 } }, context).preferences)
    .toEqual({ vibe: ["활기찬"], crowdTolerance: 0.9 });
});

it("respects either partner's dislike at the exact branch, allowing an explicit new choice", () => {
  expect(allowsCoupleVenue(candidate, [saved], emptyDateBrief())).toBe(false);
  expect(allowsCoupleVenue({ ...candidate, externalPlaceId: "branch2" }, [saved], emptyDateBrief())).toBe(true);
  expect(allowsCoupleVenue(candidate, [saved], { ...emptyDateBrief(), requiredPlaces: [candidate.name] })).toBe(true);
  expect(allowsCoupleVenue(candidate, [saved], emptyDateBrief(), ["kakao:branch1"])).toBe(true);
  expect(coupleVenueAffinity(candidate, [saved])).toBeLessThan(0);
});

it("does not transfer saved-venue preference to another branch with the same name", () => {
  const liked = { ...saved, partnerStatus: "want" as const };
  expect(coupleVenueAffinity(candidate, [liked])).toBe(16);
  expect(coupleVenueAffinity({ ...candidate, externalPlaceId: "branch2" }, [liked])).toBe(0);
});

it("keeps either partner's dislike when a second provider lists the exact same branch", () => {
  const official: DiscoverCandidate = { ...candidate, externalSource: "tourapi", externalPlaceId: "official1" };
  expect(allowsCoupleVenue(official, [saved], emptyDateBrief())).toBe(false);
  expect(coupleVenueAffinity(official, [saved])).toBe(-40);
  expect(allowsCoupleVenue({ ...official, address: "서울 성동구 성수이로 12" }, [saved], emptyDateBrief())).toBe(true);
  expect(allowsCoupleVenue({ ...official, coordinates: [127.08, 37.54] }, [saved], emptyDateBrief())).toBe(true);
  const liked = { ...saved, partnerStatus: "want" as const };
  expect(coupleVenueAffinity(candidate, [liked, saved])).toBe(-40);
});

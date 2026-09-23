import type { AIPlannerReply, AIPlannerState } from "@/features/planning/types/plan";
import { requestedRepeat } from "./courseDesign";

const sameName = (left: string, right: string) => left.replace(/\s/g, "") === right.replace(/\s/g, "");

/** Validate the user-visible transaction after venue selection, before committing it to chat. */
export function courseMutationProblems(previous: AIPlannerReply, next: AIPlannerReply, state: AIPlannerState): string[] {
  if (!state.preserveExistingPlaces || !previous.recommendations.length) return [];
  const before = previous.recommendations;
  const after = next.recommendations;
  const afterIds = new Set(after.map(place => place.placeId));
  const excluded = before.filter(place => state.excludedPlaces.some(name => sameName(name, place.name)));
  const kept = before.filter(place => !excluded.includes(place));
  const problems: string[] = [];

  for (const place of kept) {
    if (!afterIds.has(place.placeId)) problems.push(`기존 장소 누락: ${place.name}`);
  }
  for (const place of excluded) {
    if (afterIds.has(place.placeId)) problems.push(`교체 대상 유지: ${place.name}`);
  }
  if (new Set(after.map(place => place.placeId)).size !== after.length) problems.push("같은 장소 중복");

  if (state.addStop) {
    if (after.length !== before.length + 1 || afterIds.size !== after.length) problems.push("일정 추가 수 불일치");
    const added = after.filter(place => !before.some(previousPlace => previousPlace.placeId === place.placeId));
    for (const place of added) {
      if (place.activitySlot && place.activitySlot !== "other"
        && kept.some(previousPlace => previousPlace.activitySlot === place.activitySlot)
        && !requestedRepeat(state, place.activitySlot)) {
        problems.push(`일정 추가 경험 중복: ${place.activitySlot}`);
      }
    }
  } else if (excluded.length && state.intent === "modify") {
    if (after.length !== before.length) problems.push("장소 교체 수 불일치");
    if (state.areaScope !== "nearby" && previous.design?.routeBasis === "straight_line" && next.design?.routeBasis === "straight_line"
      && next.design.totalDistanceMeters > Math.max(1200, previous.design.totalDistanceMeters * 2 + 500)) {
      problems.push("교체로 동선이 크게 늘어남");
    }
    const replacements = after.filter(place => !before.some(previousPlace => previousPlace.placeId === place.placeId));
    const removedSlots = excluded.map(place => place.activitySlot).filter(Boolean).sort();
    const replacementSlots = replacements.map(place => place.activitySlot).filter(Boolean).sort();
    if (removedSlots.length && replacementSlots.length === replacements.length
      && (removedSlots.length !== replacementSlots.length || removedSlots.some((slot, index) => slot !== replacementSlots[index]))) {
      problems.push("장소 교체 역할 불일치");
    }
  } else if (state.intent === "remove" && excluded.length) {
    if (after.length !== before.length - excluded.length) problems.push("일정 제외 수 불일치");
  }
  return problems;
}

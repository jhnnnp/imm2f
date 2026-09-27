import type { AIPlannerState } from "@/features/planning/types/plan";

export function explicitlyDislikedActivities(message: string): AIPlannerState["activities"] {
  const patterns: Array<[AIPlannerState["activities"][number], RegExp]> = [
    ["cafe", /(?:카페|커피|디저트)(?:는|가|를|도|만)?\s*.{0,8}(?:싫|별로|안\s*좋아|빼|제외)/],
    ["meal", /(?:식사|식당|밥)(?:는|가|를|도|만)?\s*.{0,8}(?:싫|별로|안\s*좋아|빼|제외)/],
    ["walk", /(?:산책|걷기)(?:는|가|를|도|만)?\s*.{0,8}(?:싫|별로|안\s*좋아|빼|제외)/],
  ];
  return patterns.filter(([, pattern]) => pattern.test(message)).map(([activity]) => activity);
}

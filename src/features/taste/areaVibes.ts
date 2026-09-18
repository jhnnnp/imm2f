/** Couple date baseline only — not transit/admin labels. */
export const TASTE_AREA_VIBES = [
  "카페",
  "골목",
  "한강",
  "산책",
  "전시",
  "맛집",
  "야경",
  "한옥",
  "포장마차",
  "쇼핑",
  "공연",
  "브런치",
  "와인",
  "전망",
  "해변",
  "호수",
  "놀이",
  "시장",
  "공원",
  "레트로",
  "조용",
  "피크닉",
  "창작",
  "유적",
  "정원",
  "맥주",
  "실내",
  "온천",
  "드라이브",
] as const;

export type TasteAreaVibe = (typeof TASTE_AREA_VIBES)[number];

const VIBE_SET = new Set<string>(TASTE_AREA_VIBES);

export function isTasteAreaVibe(value: string): value is TasteAreaVibe {
  return VIBE_SET.has(value);
}

/** Spot names we never list — use canonical neighborhood via alias instead. */
export const TASTE_AREA_SPOT_BLOCKLIST = [
  /^.+역$/,
  /입구역$/,
] as const;

export function isBlockedSpotName(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return true;
  return TASTE_AREA_SPOT_BLOCKLIST.some(pattern => pattern.test(trimmed));
}

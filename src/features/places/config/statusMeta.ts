import type { PlacePreferenceStatus } from "../types/place";

export const STATUS_META: Record<PlacePreferenceStatus, { label: string; icon: string }> = {
  visited: { label: "가봤어요", icon: "✓" },
  want: { label: "가고 싶어요", icon: "♥" },
  must_visit: { label: "꼭 가고 싶어요", icon: "♥" },
  revisit: { label: "다시 갈래요", icon: "↻" },
  neutral: { label: "보통이에요", icon: "—" },
  dislike: { label: "아쉬웠어요", icon: "−" },
  not_interested: { label: "관심 없어요", icon: "×" },
};

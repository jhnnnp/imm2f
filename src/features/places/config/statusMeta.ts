import type { PlacePreferenceStatus } from "../types/place";

export const STATUS_META: Record<PlacePreferenceStatus, { label: string; icon: string }> = {
  visited: { label: "다녀왔어요", icon: "✓" },
  want: { label: "가고 싶어요", icon: "♥" },
  must_visit: { label: "가고 싶어요", icon: "♥" },
  revisit: { label: "또 가고 싶어요", icon: "↻" },
  neutral: { label: "아직 고르지 않았어요", icon: "—" },
  dislike: { label: "관심 없어요", icon: "×" },
  not_interested: { label: "관심 없어요", icon: "×" },
};

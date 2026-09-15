function formatWon(value: number) {
  const digits = Math.round(value).toString();
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `₩${grouped}`;
}

export function formatPlaceCost(value: number | null | undefined) {
  if (value == null) return "확인하지 못했습니다";
  if (value === 0) return "무료";
  return formatWon(value);
}

export function formatPlaceCostShort(value: number | null | undefined) {
  if (value == null) return "예상 비용 미확인";
  if (value === 0) return "무료";
  return `2인 예상 ${formatWon(value)}`;
}

export function formatOpeningHours(value: string | null | undefined) {
  return value?.trim() ? value : "확인하지 못했습니다";
}

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
  return `예상 ${formatWon(value)}`;
}

export function formatStayMinutes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "아직 정하지 않았어요";
  if (value % 60 === 0) return `${value / 60}시간`;
  if (value > 60) return `${Math.floor(value / 60)}시간 ${value % 60}분`;
  return `${value}분`;
}

export function formatOpeningHours(value: string | null | undefined) {
  return value?.trim() ? value : "확인하지 못했습니다";
}

export function naverPlaceSearchUrl(name: string, address?: string) {
  const query = [name, address].filter(Boolean).join(" ");
  return `https://map.naver.com/p/search/${encodeURIComponent(query)}`;
}

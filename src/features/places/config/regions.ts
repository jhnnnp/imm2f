export type PlaceRegion = {
  id: string;
  label: string;
  query: string;
  coordinates: [number, number];
  areaCode: number;
  sigunguCode?: number;
};

export const PLACE_REGIONS: ReadonlyArray<PlaceRegion> = [
  { id: "seoul", label: "서울", query: "서울", coordinates: [126.978, 37.5665], areaCode: 1 },
  { id: "busan", label: "부산", query: "부산", coordinates: [129.0756, 35.1796], areaCode: 6 },
  { id: "jeju", label: "제주", query: "제주", coordinates: [126.5312, 33.4996], areaCode: 39 },
  { id: "gunsan", label: "군산", query: "군산", coordinates: [126.7116, 35.9871], areaCode: 35, sigunguCode: 2 },
  { id: "gangneung", label: "강릉", query: "강릉", coordinates: [128.8761, 37.7519], areaCode: 32, sigunguCode: 1 },
  { id: "gyeongju", label: "경주", query: "경주", coordinates: [129.2247, 35.8562], areaCode: 37, sigunguCode: 2 },
  { id: "jeonju", label: "전주", query: "전주", coordinates: [127.148, 35.8242], areaCode: 35, sigunguCode: 1 },
  { id: "yeosu", label: "여수", query: "여수", coordinates: [127.6622, 34.7604], areaCode: 36, sigunguCode: 13 },
  { id: "sokcho", label: "속초", query: "속초", coordinates: [128.5918, 38.207], areaCode: 32, sigunguCode: 5 },
  { id: "incheon", label: "인천", query: "인천", coordinates: [126.7052, 37.4563], areaCode: 2 },
];

export const PLACE_MOODS: ReadonlyArray<{ id: string; label: string; query: string }> = [
  { id: "quiet", label: "조용한 곳", query: "조용한" },
  { id: "view", label: "뷰 좋은 곳", query: "뷰" },
  { id: "walk", label: "산책", query: "산책" },
];

export const DEFAULT_MAP_CENTER: [number, number] = [126.978, 37.5665];

export function regionByQuery(query: string | undefined) {
  const value = query?.trim() ?? "";
  return PLACE_REGIONS.find(item => item.query === value || item.label === value);
}

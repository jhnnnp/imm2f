import { TASTE_AREA_CATALOG } from "./areaCatalog";

export type TasteAreaBand = {
  id: string;
  label: string;
  regionIds: readonly string[];
};

/** 서울·수도권·여행 권역을 지리별로 묶어 한 화면에 wrap 배치합니다. */
export const TASTE_AREA_BANDS: readonly TasteAreaBand[] = [
  {
    id: "seoul-east",
    label: "동부",
    regionIds: ["seongsu", "gwangjin", "jamsil"],
  },
  {
    id: "seoul-central",
    label: "중심",
    regionIds: ["euljiro", "jongno"],
  },
  {
    id: "seoul-west",
    label: "서부",
    regionIds: ["hongdae", "hangang"],
  },
  {
    id: "seoul-south",
    label: "남부",
    regionIds: ["hannam", "gangnam"],
  },
  {
    id: "seoul-north",
    label: "북부",
    regionIds: ["north"],
  },
  {
    id: "metro",
    label: "수도권",
    regionIds: ["bundang", "metro-suwon", "metro-incheon", "metro-west"],
  },
  {
    id: "trip",
    label: "여행",
    regionIds: ["trip-jeju", "trip-busan", "trip-honam", "trip-gangwon", "trip-near"],
  },
] as const;

const REGION_BY_ID = new Map(TASTE_AREA_CATALOG.map(region => [region.id, region]));

export function tasteAreaRegionById(id: string) {
  return REGION_BY_ID.get(id);
}

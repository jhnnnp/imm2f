import type { PlaceCategoryId } from "@/features/places/types/place";
import type { TourContentTypeId } from "./client";

/** TourAPI publishes these as distinct content types. A keyword search for
 * tourist type 12 cannot retrieve type 14/15/28/38 records. */
export function tourContentTypeForIntent(input: { category?: PlaceCategoryId; query?: string }): TourContentTypeId | null {
  const query = input.query ?? "";
  if (input.category === "festival" || /축제|페스티벌|지역\s*행사/.test(query)) return "15";
  if (/쇼핑|아울렛|아웃렛|백화점|시장|상점가|소품샵|편집샵/.test(query)) return "38";
  if (/체험|공방|원데이\s*클래스|액티비티|레포츠|서핑|카약/.test(query)) return "28";
  if (input.category === "photo" || /전시|미술관|박물관|문화시설/.test(query)) return "14";
  if (input.category === "tourist" || input.category === "nature") return "12";
  return null;
}

/** For broad interests, browse the source type in the chosen region. TourAPI
 * keyword matching is not a substitute for its type and area indexes. */
export function tourDiscoveryQuery(typeId: TourContentTypeId, query?: string): string {
  const value = query?.trim().replace(/\s+/g, " ") ?? "";
  if (typeId === "15") return value && !/^(?:축제|페스티벌|지역 행사)$/.test(value) ? value : "축제";
  const generic = typeId === "14" ? /^(?:전시|문화시설|미술관|박물관|갤러리)$/
    : typeId === "28" ? /^(?:체험|공방|원데이 클래스|액티비티|레포츠)$/
      : typeId === "38" ? /^(?:쇼핑|쇼핑몰|상점가)$/ : null;
  if (generic) return generic.test(value) ? "" : value;
  return query ?? "";
}

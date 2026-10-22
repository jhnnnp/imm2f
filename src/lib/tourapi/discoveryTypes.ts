import type { PlaceCategoryId } from "@/features/places/types/place";
import type { TourContentTypeId } from "./client";

/** TourAPI publishes these as distinct content types. A keyword search for
 * tourist type 12 cannot retrieve type 14/15/28/38/39 records. */
export function tourContentTypeForIntent(input: { category?: PlaceCategoryId; query?: string }): TourContentTypeId | null {
  const query = input.query ?? "";
  if (input.category === "festival" || /축제|페스티벌|지역\s*행사/.test(query)) return "15";
  // Type 39 is the official food-service dataset, not a verified cafe taxonomy.
  if (input.category === "cafe") return null;
  if (input.category === "restaurant") return "39";
  if (!/카페|커피|디저트|베이커리|찻집|티룸/.test(query)
    && /음식점|식당|레스토랑|맛집|한식|한정식|일식|중식|양식|파스타|초밥|스시|라멘|국밥|비빔밥|삼겹|갈비/.test(query)) return "39";
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
  if (typeId === "39") {
    // searchKeyword2 matches venue titles, not firstmenu/treatmenu. Browse
    // the local food dataset for dish/cuisine requests, then verify its menus.
    const namedPart = value.replace(/한정식|한식|일식|중식|양식|이탈리안|이탈리아|프렌치|파스타|초밥|스시|라멘|국밥|비빔밥|삼겹살|삼겹|갈비|스테이크|한우|피자|돈까스|돈카츠|브런치|짜장면|짬뽕|냉면|해산물|해물|채식|비건|오마카세|음식점|레스토랑|식당|맛집|식사|전문점|추천|음식|요리/g, "")
      .replace(/[\s·,/|]+/g, "");
    return namedPart ? value : "";
  }
  const generic = typeId === "14" ? /^(?:전시|문화시설|미술관|박물관|갤러리)$/
    : typeId === "28" ? /^(?:체험|공방|원데이 클래스|액티비티|레포츠)$/
      : typeId === "38" ? /^(?:쇼핑|쇼핑몰|상점가)$/ : null;
  if (generic) return generic.test(value) ? "" : value;
  return query ?? "";
}

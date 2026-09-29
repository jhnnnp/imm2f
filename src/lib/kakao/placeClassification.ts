/** Interprets provider taxonomy without treating a search keyword as a venue fact. */
export type ShoppingPlaceKind = "mall" | "department" | "outlet" | "market" | "select_shop";
export type KakaoPlaceClassification = {
  shoppingKind: ShoppingPlaceKind | null;
  visitable: boolean;
  evidence: "provider_category" | "none";
};

export type PlaceExperienceKind = "coast" | "nature" | "nightview";
export type PlaceExperienceSignal = {
  kind: PlaceExperienceKind;
  source: "provider_category" | "place_name";
};
export type DiscoveryIntent = "shopping" | "experience" | "festival" | "culture";
export type DiscoverySignal = { kind: DiscoveryIntent;
  source: "provider_category" | "place_name" };

const EXPERIENCE_CATEGORY: Record<PlaceExperienceKind, RegExp> = {
  coast: /해수욕장|해변|해안|해안산책로|해변산책로/,
  nature: /공원|숲|수목원|식물원|휴양림|정원|생태|호수|하천|폭포|산책로/,
  nightview: /야경|전망대|전망공원|루프탑|빛축제/,
};
const EXPERIENCE_NAME: Record<PlaceExperienceKind, RegExp> = {
  coast: /바다|해변|해수욕|해안|해변길|해안길|바닷길/,
  nature: /공원|숲|수목원|식물원|휴양림|정원|생태|호수|하천|폭포|산책로/,
  nightview: /야경|전망|전망대|전망공원|스카이|타워|루프탑|빛축제|빛의\s*정원/,
};

/** A venue signal is a search fit, not proof of hours, view, or experience quality. */
export function classifyPlaceExperiences(input: {
  name: string; detailedCategory?: string; categoryLabel?: string;
}): PlaceExperienceSignal[] {
  const category = `${input.detailedCategory ?? ""} ${input.categoryLabel ?? ""}`;
  return (Object.keys(EXPERIENCE_CATEGORY) as PlaceExperienceKind[]).flatMap<PlaceExperienceSignal>(kind => {
    if (EXPERIENCE_CATEGORY[kind].test(category)) return [{ kind, source: "provider_category" as const }];
    if (EXPERIENCE_NAME[kind].test(input.name)) return [{ kind, source: "place_name" as const }];
    return [];
  });
}

const SHOPPING_CATEGORY: Array<[ShoppingPlaceKind, RegExp]> = [
  ["department", /(?:^|>)\s*백화점(?:\s*>|$)/],
  ["outlet", /(?:^|>)\s*(?:아울렛|아웃렛|상설할인매장)(?:\s*>|$)/],
  ["market", /(?:^|>)\s*(?:시장|상점가)(?:\s*>|$)/],
  ["mall", /(?:^|>)\s*(?:쇼핑몰|쇼핑센터|패션몰|복합쇼핑몰|쇼핑타운|상가,아케이드|지하상가)(?:\s*>|$)/],
  ["select_shop", /(?:^|>)\s*(?:소품샵|편집샵|셀렉트샵)(?:\s*>|$)/],
  ["select_shop", /(?:^|>)\s*(?:디자인문구|기념품점|공예품점|소품가게|잡화점)(?:\s*>|$)/],
];
const NON_VISITABLE_CATEGORY = /통신판매|인터넷쇼핑몰|온라인쇼핑|도매|물류|슈퍼마켓|편의점|아파트상가/;
const NON_DESTINATION_NAME = /고객센터|관리사무소|주차장|안내소|물류센터|상가동|아파트.*상가/;

export function classifyKakaoPlace(input: {
  name: string; detailedCategory?: string; groupCode?: string;
}): KakaoPlaceClassification {
  const category = input.detailedCategory ?? "";
  const name = input.name ?? "";
  if (NON_VISITABLE_CATEGORY.test(category) || NON_DESTINATION_NAME.test(name))
    return { shoppingKind: null, visitable: false, evidence: "provider_category" };
  const shoppingKind = SHOPPING_CATEGORY.find(([, expression]) => expression.test(category))?.[0] ?? null;
  if (shoppingKind) return { shoppingKind, visitable: true, evidence: "provider_category" };
  // MT1 includes supermarkets and groceries. Require a recognized shopping
  // category above; neither the group code nor a query hit is sufficient.
  return { shoppingKind: null, visitable: true, evidence: "none" };
}

/** Search context may admit shopping records; classification still verifies each result. */
export function isShoppingSearch(query: string | undefined) {
  return /쇼핑|백화점|아울렛|아웃렛|시장|상점가|편집샵|소품샵|상설할인매장/.test(query ?? "");
}

/** Source-backed discovery intent. A matched search query is never evidence
 * that a venue is a shop, event, or operating hands-on program. */
export function classifyDiscoveryIntents(input: {
  externalSource: "kakao" | "tourapi"; name: string; category?: string;
  categoryLabel?: string; detailedCategory?: string; kakaoCategoryGroupCode?: string;
  tourContentTypeId?: string;
}): DiscoverySignal[] {
  const category = `${input.detailedCategory ?? ""} ${input.categoryLabel ?? ""}`;
  const forbidden = /고객센터|관리사무소|주차장|물류센터|도매시장|관광안내소|여행사|체험단|온라인|통신판매/;
  if (forbidden.test(input.name) || forbidden.test(category)) return [];
  const signals: DiscoverySignal[] = [];
  const add = (kind: DiscoveryIntent, source: DiscoverySignal["source"]) => {
    if (!signals.some(signal => signal.kind === kind)) signals.push({ kind, source });
  };
  if (input.externalSource === "tourapi") {
    if (input.tourContentTypeId === "38") add("shopping", "provider_category");
    if (input.tourContentTypeId === "28") add("experience", "provider_category");
    if (input.tourContentTypeId === "15") add("festival", "provider_category");
    if (input.tourContentTypeId === "14") add("culture", "provider_category");
  } else {
    const shopping = classifyKakaoPlace({ name: input.name,
      detailedCategory: input.detailedCategory, groupCode: input.kakaoCategoryGroupCode });
    if (shopping.shoppingKind && shopping.visitable) add("shopping", "provider_category");
    if (/축제|페스티벌|행사장/.test(category)) add("festival", "provider_category");
    if (/공방|체험장|체험관|체험센터|원데이클래스|레포츠|액티비티|방탈출|볼링장|보드게임/.test(category))
      add("experience", "provider_category");
    if (/미술관|박물관|전시관|전시장|갤러리|문화시설/.test(category)) add("culture", "provider_category");
  }
  if (!signals.some(signal => signal.kind === "experience")
    && /공방|체험장|체험관|원데이\s*클래스|방탈출|볼링장|보드게임|짚라인|카약|서핑/.test(input.name)
    && input.category !== "restaurant" && input.category !== "cafe") add("experience", "place_name");
  if (!signals.some(signal => signal.kind === "festival") && /축제|페스티벌/.test(input.name)
    && input.category !== "restaurant" && input.category !== "cafe") add("festival", "place_name");
  return signals;
}

export function shoppingSubtype(input: {
  externalSource: "kakao" | "tourapi"; name: string; detailedCategory?: string;
  kakaoCategoryGroupCode?: string; tourContentTypeId?: string;
}): ShoppingPlaceKind | null {
  if (input.externalSource === "kakao") return classifyKakaoPlace({ name: input.name,
    detailedCategory: input.detailedCategory, groupCode: input.kakaoCategoryGroupCode }).shoppingKind;
  if (input.tourContentTypeId !== "38") return null;
  const text = `${input.name} ${input.detailedCategory ?? ""}`;
  if (/백화점/.test(text)) return "department";
  if (/아울렛|아웃렛|상설할인매장/.test(text)) return "outlet";
  if (/시장|상점가/.test(text)) return "market";
  if (/소품샵|편집샵|셀렉트샵|기념품/.test(text)) return "select_shop";
  if (/쇼핑몰|복합몰|패션몰/.test(text)) return "mall";
  return null;
}

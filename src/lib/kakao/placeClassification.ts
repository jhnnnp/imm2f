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

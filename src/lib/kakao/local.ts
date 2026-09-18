import { kakaoCategoryQuery, kakaoGroupCode } from "@/features/places/config/kakaoCategories";
import type { KakaoPlaceCandidate, PlaceCategoryId } from "@/features/places/types/place";
import { getKakaoApiKeys } from "./env";

type KakaoKeywordDocument = {
  id?: string;
  place_name?: string;
  category_name?: string;
  category_group_code?: string;
  category_group_name?: string;
  phone?: string;
  address_name?: string;
  road_address_name?: string;
  x?: string;
  y?: string;
  place_url?: string;
  distance?: string;
};

type KakaoKeywordResponse = {
  documents?: KakaoKeywordDocument[];
  meta?: { is_end?: boolean; total_count?: number };
};

export type KakaoSearchErrorCode = "not_configured" | "invalid_key" | "rate_limited" | "empty_query" | "unavailable" | "domain";

export type KakaoSearchInput = {
  query?: string;
  region?: string;
  category?: PlaceCategoryId | "all";
  mood?: string;
  x?: number;
  y?: number;
  radius?: number;
  page?: number;
};

export type KakaoSearchResult =
  | { ok: true; places: KakaoPlaceCandidate[]; isEnd: boolean; page: number; totalCount: number }
  | { ok: false; code: KakaoSearchErrorCode; error: string };

const KAKAO_KEYWORD_URL = "https://dapi.kakao.com/v2/local/search/keyword.json";
const KAKAO_CATEGORY_URL = "https://dapi.kakao.com/v2/local/search/category.json";
const PAGE_SIZE = 15;
const NATURE_CATEGORY = /공원|숲|산|봉우리|해변|해수욕|계곡|호수|폭포|수목원|식물원|자연|생태|한강|하천|섬|해안/;
const STAY_CATEGORY = /호텔|펜션|숙박|게스트하우스|리조트|모텔|여관/;
const FESTIVAL_CATEGORY = /축제|페스티벌|페스티발/;
const KAKAO_UTILITY_GROUP_CODES = new Set([
  "MT1", "CS2", "PS3", "SC4", "AC5", "PK6", "OL7", "SW8", "BK9", "AG2", "PO3", "HP8", "PM9",
]);

export function isKakaoUtilityGroupCode(code: string | undefined) {
  return KAKAO_UTILITY_GROUP_CODES.has(code ?? "");
}

export function mapKakaoCategory(groupCode: string, categoryName: string): { id: PlaceCategoryId; label: string } {
  const name = categoryName.replace(/\s+/g, "");
  const last = categoryName.split(">").map(part => part.trim()).filter(Boolean).at(-1) || "";
  if (name.includes("서점") || name.includes("책방") || name.includes("북카페") || name.includes("도서관")) return { id: "book", label: "책방" };
  if (FESTIVAL_CATEGORY.test(name)) return { id: "festival", label: "축제" };
  if (name.includes("사진") || name.includes("포토")) return { id: "photo", label: "사진" };
  if (groupCode === "CE7") return { id: "cafe", label: "카페" };
  if (groupCode === "FD6") return { id: "restaurant", label: "음식점" };
  if (groupCode === "AD5" || STAY_CATEGORY.test(name)) return { id: "stay", label: "숙박" };
  if (groupCode === "AT4") {
    if (NATURE_CATEGORY.test(last) || NATURE_CATEGORY.test(name)) return { id: "nature", label: "자연" };
    return { id: "tourist", label: "관광지" };
  }
  if (groupCode === "CT1") return { id: "photo", label: "사진" };
  // Unknown Kakao categories must never inherit cafe semantics. The date planner
  // validates these separately and only admits a small set of safe exceptions.
  return { id: "tourist", label: last || "장소" };
}

export function districtFromAddress(address: string) {
  const parts = address.split(/\s+/).filter(Boolean);
  if (parts.length >= 3) return `${parts[1]} ${parts[2]}`.replace(/특별자치도|광역시|특별시/g, "").trim();
  return address;
}

function toCandidate(document: KakaoKeywordDocument): KakaoPlaceCandidate | null {
  if (!document.id || !document.place_name) return null;
  if (isKakaoUtilityGroupCode(document.category_group_code)) return null;
  const lng = Number(document.x);
  const lat = Number(document.y);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  const categoryName = document.category_name ?? "";
  const mapped = mapKakaoCategory(document.category_group_code ?? "", categoryName);
  const address = document.address_name ?? "";
  return {
    externalSource: "kakao",
    externalPlaceId: document.id,
    name: document.place_name,
    category: mapped.id,
    categoryLabel: document.category_group_name || mapped.label,
    district: districtFromAddress(document.road_address_name || address),
    address,
    roadAddress: document.road_address_name ?? "",
    phone: document.phone ?? "",
    mapUrl: document.place_url ?? "",
    coordinates: [lng, lat],
    detailedCategory: categoryName,
    kakaoCategoryGroupCode: document.category_group_code ?? "",
    distanceMeters: document.distance ? Number(document.distance) : undefined,
  };
}

function kakaoOrigin() {
  return process.env.NEXT_PUBLIC_SITE_URL?.trim() || "http://127.0.0.1:3000";
}

function hasLocation(input: KakaoSearchInput) {
  return Number.isFinite(input.x) && Number.isFinite(input.y);
}

function clampRadius(meters: number | undefined) {
  return Math.min(20000, Math.max(300, Math.round(meters ?? 2000)));
}

function buildKeyword(input: KakaoSearchInput) {
  const parts = [input.region, input.query, input.mood]
    .map(value => value?.trim() ?? "")
    .filter(Boolean);
  if (!input.query?.trim() && (!hasLocation(input) || !kakaoGroupCode(input.category))) {
    const categoryQuery = kakaoCategoryQuery(input.category);
    if (categoryQuery) parts.push(categoryQuery);
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function applyCommonParams(url: URL, input: KakaoSearchInput) {
  url.searchParams.set("size", String(PAGE_SIZE));
  url.searchParams.set("page", String(Math.min(45, Math.max(1, input.page ?? 1))));
  if (hasLocation(input)) {
    url.searchParams.set("x", String(input.x));
    url.searchParams.set("y", String(input.y));
    url.searchParams.set("radius", String(clampRadius(input.radius)));
    url.searchParams.set("sort", "distance");
  }
}

function buildSearchUrl(input: KakaoSearchInput) {
  const groupCode = kakaoGroupCode(input.category);
  const keyword = buildKeyword(input);
  const useCategory = Boolean(hasLocation(input) && groupCode && !input.query?.trim() && !input.mood?.trim());
  if (useCategory && groupCode) {
    const url = new URL(KAKAO_CATEGORY_URL);
    url.searchParams.set("category_group_code", groupCode);
    applyCommonParams(url, input);
    return { url, keyword };
  }
  const url = new URL(KAKAO_KEYWORD_URL);
  url.searchParams.set("query", keyword);
  if (groupCode) url.searchParams.set("category_group_code", groupCode);
  applyCommonParams(url, input);
  return { url, keyword };
}

async function requestKakao(key: string, url: URL) {
  return fetch(url, {
    headers: {
      Authorization: `KakaoAK ${key}`,
      KA: `sdk/1.0 os/javascript origin/${kakaoOrigin()}`,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(6000),
  });
}

function messageFromKakaoBody(text: string, status: number): KakaoSearchResult | null {
  const lower = text.toLowerCase();
  if (lower.includes("domain mismatched") || lower.includes("registered web domains")) {
    return {
      ok: false,
      code: "domain",
      error: "카카오 앱에 웹 도메인이 없어요. 플랫폼 > Web에 http://127.0.0.1:3000 과 http://localhost:3000 을 등록해 주세요.",
    };
  }
  if (status === 401 || status === 403 || lower.includes("appkey") || lower.includes("does not exist")) {
    return {
      ok: false,
      code: "invalid_key",
      error: "카카오 키가 아직 로컬 API에 연결되지 않았어요. 제품 설정에서 카카오맵을 켜고 REST API 키를 다시 확인해 주세요.",
    };
  }
  return null;
}

export async function searchKakaoPlacesRemote(input: KakaoSearchInput): Promise<KakaoSearchResult> {
  const page = Math.min(45, Math.max(1, input.page ?? 1));
  const { url, keyword } = buildSearchUrl(input);
  const usingCategory = url.pathname.includes("category.json");
  if (!usingCategory && keyword.length < 2) {
    return { ok: false, code: "empty_query", error: "지역이나 장소 이름을 두 글자 이상 입력해 주세요." };
  }

  const keys = getKakaoApiKeys();
  if (!keys.length) return { ok: false, code: "not_configured", error: "카카오 키가 없어요. .env.local을 확인해 주세요." };

  let lastError: KakaoSearchResult = { ok: false, code: "unavailable", error: "장소를 불러오지 못했어요." };

  try {
    for (const key of keys) {
      const response = await requestKakao(key, url);
      const text = await response.text();
      if (response.status === 429) {
        return { ok: false, code: "rate_limited", error: "검색 한도를 잠시 넘었어요. 조금 뒤에 다시 시도해 주세요." };
      }
      if (!response.ok) {
        const mapped = messageFromKakaoBody(text, response.status);
        if (mapped && !mapped.ok && mapped.code === "domain") return mapped;
        lastError = mapped ?? lastError;
        continue;
      }
      const payload = JSON.parse(text) as KakaoKeywordResponse;
      const mapped = (payload.documents ?? []).map(toCandidate).filter((item): item is KakaoPlaceCandidate => item !== null);
      const categorized = input.category && input.category !== "all"
        ? mapped.filter(place => place.category === input.category)
        : mapped;
      const administrativeArea = input.region?.split(/\s+/).findLast(part => /(?:구|군|시)$/.test(part));
      const scoped = administrativeArea
        ? categorized.filter(place => `${place.address} ${place.roadAddress} ${place.district}`.includes(administrativeArea))
        : [];
      const places = scoped.length ? scoped : categorized;
      return {
        ok: true,
        places,
        isEnd: Boolean(payload.meta?.is_end),
        page,
        totalCount: payload.meta?.total_count ?? places.length,
      };
    }
    return lastError;
  } catch {
    return { ok: false, code: "unavailable", error: "장소를 불러오지 못했어요." };
  }
}

export async function searchKakaoKeyword(query: string): Promise<KakaoSearchResult> {
  return searchKakaoPlacesRemote({ query });
}

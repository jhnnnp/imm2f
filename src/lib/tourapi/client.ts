import type { KakaoSearchErrorCode, KakaoSearchInput, KakaoSearchResult } from "@/lib/kakao/local";
import { regionByQuery } from "@/features/places/config/regions";
import { districtFromAddress } from "@/lib/kakao/local";
import type { DiscoverCandidate, PlaceCategoryId } from "@/features/places/types/place";
import { getTourApiServiceKey } from "./env";

const TOUR_BASE = "https://apis.data.go.kr/B551011/KorService2";
const PAGE_SIZE = 15;

const CONTENT_TYPE: Record<"tourist" | "festival" | "stay", string> = {
  tourist: "12",
  festival: "15",
  stay: "32",
};

type TourItem = {
  contentid?: number | string;
  contentId?: number | string;
  title?: string;
  addr1?: string;
  addr2?: string;
  tel?: string;
  mapx?: string;
  mapX?: string;
  mapy?: string;
  mapY?: string;
  firstimage?: string;
  firstimage2?: string;
  overview?: string;
  originimgurl?: string;
};

type TourResponse = {
  response?: {
    header?: { resultCode?: string; resultMsg?: string };
    body?: {
      items?: { item?: TourItem | TourItem[] } | string;
      totalCount?: number;
    };
  };
};

export type TourPlaceDetail = {
  overview: string;
  image?: string;
};

function asItems(value: TourResponse["response"]): TourItem[] {
  const raw = value?.body?.items;
  if (!raw || typeof raw === "string") return [];
  const item = raw.item;
  if (!item) return [];
  return Array.isArray(item) ? item : [item];
}

function serviceKey() {
  const raw = getTourApiServiceKey();
  if (!raw) return "";
  try {
    return raw.includes("%") ? decodeURIComponent(raw) : raw;
  } catch {
    return raw;
  }
}

function contentTypeId(category: PlaceCategoryId | "all" | undefined) {
  if (category === "festival") return CONTENT_TYPE.festival;
  if (category === "stay") return CONTENT_TYPE.stay;
  return CONTENT_TYPE.tourist;
}

function mappedCategory(category: PlaceCategoryId | "all" | undefined): PlaceCategoryId {
  return category === "festival" || category === "stay" ? category : "tourist";
}

function toCandidate(item: TourItem, category: PlaceCategoryId): DiscoverCandidate | null {
  const id = String(item.contentid ?? item.contentId ?? "").trim();
  const name = item.title?.trim() ?? "";
  const lng = Number(item.mapx ?? item.mapX);
  const lat = Number(item.mapy ?? item.mapY);
  if (!id || !name || !Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  const address = item.addr1 ?? "";
  const label = category === "festival" ? "축제" : category === "stay" ? "숙박" : "관광지";
  return {
    externalSource: "tourapi",
    externalPlaceId: id,
    name,
    category,
    categoryLabel: label,
    district: districtFromAddress(address) || address,
    address,
    roadAddress: item.addr2 ?? "",
    phone: item.tel ?? "",
    mapUrl: `https://korean.visitkorea.or.kr/detail/ms_detail.do?cotid=${id}`,
    coordinates: [lng, lat],
    image: item.firstimage || item.firstimage2 || item.originimgurl || undefined,
  };
}

async function tourFetch(path: string, params: Record<string, string>): Promise<{ ok: true; payload: TourResponse; page: number } | { ok: false; code: KakaoSearchErrorCode; error: string }> {
  const key = serviceKey();
  if (!key) {
    return { ok: false, code: "not_configured", error: "TourAPI 키가 없어요. .env.local의 TOUR_API_SERVICE_KEY를 확인해 주세요." };
  }
  const url = new URL(`${TOUR_BASE}/${path}`);
  url.searchParams.set("serviceKey", key);
  url.searchParams.set("MobileOS", "ETC");
  url.searchParams.set("MobileApp", "OnlyUs");
  url.searchParams.set("_type", "json");
  url.searchParams.set("numOfRows", String(PAGE_SIZE));
  Object.entries(params).forEach(([name, value]) => {
    if (value) url.searchParams.set(name, value);
  });

  try {
    const response = await fetch(url, { cache: "no-store" });
    const text = await response.text();
    if (response.status === 429) {
      return { ok: false, code: "rate_limited", error: "TourAPI 한도를 잠시 넘었어요. 조금 뒤에 다시 시도해 주세요." };
    }
    if (!response.ok) {
      return { ok: false, code: "unavailable", error: "TourAPI를 불러오지 못했어요." };
    }
    if (text.trim().startsWith("<")) {
      return { ok: false, code: "invalid_key", error: "TourAPI 키가 거부되었어요. data.go.kr에서 KorService2 활용신청과 키를 확인해 주세요." };
    }
    const payload = JSON.parse(text) as TourResponse;
    const code = payload.response?.header?.resultCode ?? "";
    if (code && code !== "0000") {
      return { ok: false, code: "unavailable", error: payload.response?.header?.resultMsg || "TourAPI를 불러오지 못했어요." };
    }
    return { ok: true, payload, page: Number(params.pageNo || "1") };
  } catch {
    return { ok: false, code: "unavailable", error: "TourAPI를 불러오지 못했어요." };
  }
}

export async function searchTourPlacesRemote(input: KakaoSearchInput): Promise<KakaoSearchResult> {
  const page = String(Math.min(45, Math.max(1, input.page ?? 1)));
  const category = mappedCategory(input.category);
  const typeId = contentTypeId(category);
  const region = regionByQuery(input.region);
  const keyword = [input.region, input.query, input.mood].map(value => value?.trim() ?? "").filter(Boolean).join(" ").trim();
  const common = { pageNo: page, contentTypeId: typeId };

  let fetched;
  if (Number.isFinite(input.x) && Number.isFinite(input.y)) {
    fetched = await tourFetch("locationBasedList2", {
      ...common,
      mapX: String(input.x),
      mapY: String(input.y),
      radius: String(Math.min(20000, Math.max(300, Math.round(input.radius ?? 2000)))),
      arrange: "E",
    });
  } else if (keyword && (input.query?.trim() || input.mood?.trim() || !region)) {
    fetched = await tourFetch("searchKeyword2", {
      ...common,
      keyword: keyword.length >= 2 ? keyword : `${keyword} 여행`,
      areaCode: region ? String(region.areaCode) : "",
      sigunguCode: region?.sigunguCode ? String(region.sigunguCode) : "",
      arrange: "C",
    });
  } else if (!region) {
    return { ok: false, code: "empty_query", error: "지역을 고르거나 검색어를 입력해 주세요." };
  } else {
    fetched = await tourFetch("areaBasedList2", {
      ...common,
      areaCode: String(region.areaCode),
      sigunguCode: region.sigunguCode ? String(region.sigunguCode) : "",
      arrange: "Q",
    });
  }

  if (!fetched.ok) return fetched;
  const totalCount = fetched.payload.response?.body?.totalCount ?? 0;
  const places = asItems(fetched.payload.response)
    .map(item => toCandidate(item, category))
    .filter((item): item is DiscoverCandidate => item !== null);
  return {
    ok: true,
    places,
    isEnd: fetched.page * PAGE_SIZE >= totalCount || places.length < PAGE_SIZE,
    page: fetched.page,
    totalCount,
  };
}

export async function loadTourPlaceDetail(contentId: string): Promise<TourPlaceDetail | null> {
  const id = contentId.trim();
  if (!id) return null;
  const [common, images] = await Promise.all([
    tourFetch("detailCommon2", { contentId: id, overviewYN: "Y", defaultYN: "Y", firstImageYN: "Y" }),
    tourFetch("detailImage2", { contentId: id, imageYN: "Y", subImageYN: "Y" }),
  ]);
  const commonItem = common.ok ? asItems(common.payload.response)[0] : undefined;
  const imageItem = images.ok ? asItems(images.payload.response)[0] : undefined;
  const overview = commonItem?.overview?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() ?? "";
  const image = commonItem?.firstimage || commonItem?.firstimage2 || imageItem?.originimgurl || imageItem?.firstimage;
  if (!overview && !image) return null;
  return { overview, image };
}

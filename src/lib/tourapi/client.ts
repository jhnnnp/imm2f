import type { KakaoSearchErrorCode, KakaoSearchInput, KakaoSearchResult } from "@/lib/kakao/local";
import { PLACE_AREA_GROUPS, regionByQuery, type PlaceArea } from "@/features/places/config/regions";
import { districtFromAddress } from "@/lib/kakao/local";
import type { DiscoverCandidate, PlaceCategoryId } from "@/features/places/types/place";
import { getTourApiServiceKey } from "./env";
import { compactEventYmd, formatEventPeriod, isEndedFestival, koreaTodayYmd, ldongRegnCdFromAreaCode } from "./festivalSchedule";

const TOUR_BASE = "https://apis.data.go.kr/B551011/KorService2";
const PAGE_SIZE = 15;
const FESTIVAL_PAGE_SIZE = 30;
const FESTIVAL_SKIP_EMPTY_PAGES = 2;

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
  homepage?: string;
  usetime?: string;
  restdate?: string;
  parking?: string;
  chkpet?: string;
  eventstartdate?: string;
  eventStartDate?: string;
  eventenddate?: string;
  eventEndDate?: string;
  playtime?: string;
  spendtimefestival?: string;
  checkintime?: string;
  checkouttime?: string;
  parkinglodging?: string;
  reservationurl?: string;
};

type TourResponse = {
  resultCode?: string;
  resultMsg?: string;
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
  openingHours?: string;
  homepage?: string;
  facts: Array<{ label: string; value: string }>;
};

function cleanText(value: unknown) {
  return typeof value === "string" ? value.replace(/<br\s*\/?\s*>/gi, " · ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "";
}

function extractUrl(value: unknown) {
  return typeof value === "string" ? value.match(/https?:\/\/[^\s"'<>]+/)?.[0] : undefined;
}

function festivalStart(item: TourItem) {
  return item.eventstartdate || item.eventStartDate;
}

function festivalEnd(item: TourItem) {
  return item.eventenddate || item.eventEndDate;
}

function festivalHasPeriod(item: TourItem) {
  return Boolean(compactEventYmd(festivalEnd(item)) || compactEventYmd(festivalStart(item)));
}

function detailFacts(item: TourItem | undefined, category: PlaceCategoryId) {
  if (!item) return [];
  const facts: Array<{ label: string; value: string }> = [];
  const add = (label: string, value: unknown) => {
    const cleaned = cleanText(value);
    if (cleaned) facts.push({ label, value: cleaned });
  };
  if (category === "festival") {
    add("기간", formatEventPeriod(festivalStart(item), festivalEnd(item)));
    add("운영", item.playtime);
    add("관람 시간", item.spendtimefestival);
  } else if (category === "stay") {
    add("체크인", item.checkintime);
    add("체크아웃", item.checkouttime);
    add("주차", item.parkinglodging);
  } else {
    add("휴무", item.restdate);
    add("주차", item.parking);
    add("반려동물", item.chkpet);
  }
  return facts.slice(0, 4);
}

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
  const period = category === "festival" ? formatEventPeriod(festivalStart(item), festivalEnd(item)) : "";
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
    openingHours: period || undefined,
    detailedCategory: category === "festival" ? (period ? `축제 > ${period}` : "축제")
      : category === "stay" ? "숙박" : "관광명소",
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
      return { ok: false, code: "rate_limited", error: "검색 한도를 잠시 넘었어요. 조금 뒤에 다시 시도해 주세요." };
    }
    if (!response.ok) {
      return { ok: false, code: "unavailable", error: "장소를 불러오지 못했어요." };
    }
    if (text.trim().startsWith("<")) {
      return { ok: false, code: "invalid_key", error: "TourAPI 키가 거부되었어요. data.go.kr에서 KorService2 활용신청과 키를 확인해 주세요." };
    }
    const payload = JSON.parse(text) as TourResponse;
    const code = payload.response?.header?.resultCode ?? payload.resultCode ?? "";
    if (code && code !== "0000") {
      return { ok: false, code: "unavailable", error: payload.response?.header?.resultMsg || payload.resultMsg || "장소를 불러오지 못했어요." };
    }
    return { ok: true, payload, page: Number(params.pageNo || "1") };
  } catch {
    return { ok: false, code: "unavailable", error: "장소를 불러오지 못했어요." };
  }
}

/** List rows from searchFestival2 already use eventStartDate; skip per-item detailIntro2 on browse. */
function discoverFestivalItems(items: TourItem[]) {
  return items.filter(item => {
    if (!festivalHasPeriod(item)) return true;
    return !isEndedFestival(festivalStart(item), festivalEnd(item));
  });
}

function haversineMeters(lng1: number, lat1: number, lng2: number, lat2: number) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * 6371000 * Math.asin(Math.sqrt(a)));
}

function nearestAreaGroup(lng: number, lat: number) {
  return PLACE_AREA_GROUPS.reduce((best, group) => {
    const distance = haversineMeters(lng, lat, group.coordinates[0], group.coordinates[1]);
    const bestDistance = haversineMeters(lng, lat, best.coordinates[0], best.coordinates[1]);
    return distance < bestDistance ? group : best;
  });
}

function resolveFestivalRegion(input: KakaoSearchInput): PlaceArea | undefined {
  const direct = regionByQuery(input.region);
  if (direct) return direct;
  const text = `${input.region ?? ""} ${input.query ?? ""}`.trim();
  if (text) {
    const parts = [text, ...text.split(/\s+/)].filter(Boolean);
    for (const part of parts) {
      const match = regionByQuery(part);
      if (match) return match;
    }
    for (const group of PLACE_AREA_GROUPS) {
      if (text.includes(group.label) || text.includes(group.query)) {
        return { query: group.query, coordinates: group.coordinates, areaCode: group.areaCode };
      }
      const area = group.areas.find(item => text.includes(item.label) || text.includes(item.query));
      if (area) {
        return { query: area.query, coordinates: area.coordinates, areaCode: area.areaCode, sigunguCode: area.sigunguCode, radius: area.radius };
      }
    }
  }
  if (Number.isFinite(input.x) && Number.isFinite(input.y)) {
    const group = nearestAreaGroup(Number(input.x), Number(input.y));
    return { query: group.query, coordinates: group.coordinates, areaCode: group.areaCode };
  }
  return undefined;
}

function festivalSearchTokens(input: KakaoSearchInput, region?: PlaceArea) {
  let text = `${input.query ?? ""} ${input.mood ?? ""}`;
  text = text.replace(/축제|페스티벌|페스티발|\bfestival\b/gi, " ");
  if (region?.query) text = text.split(region.query).join(" ");
  for (const group of PLACE_AREA_GROUPS) {
    text = text.split(group.label).join(" ").split(group.query).join(" ");
  }
  return [...new Set(text.split(/\s+/).map(part => part.trim()).filter(part => part.length >= 2))];
}

function festivalItemMatches(item: TourItem, tokens: string[], origin?: { x: number; y: number; radius: number }) {
  if (tokens.length) {
    const blob = `${item.title ?? ""} ${item.addr1 ?? ""} ${item.addr2 ?? ""}`;
    if (!tokens.every(token => blob.includes(token))) return false;
  }
  if (!origin) return true;
  const lng = Number(item.mapx ?? item.mapX);
  const lat = Number(item.mapy ?? item.mapY);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
  return haversineMeters(origin.x, origin.y, lng, lat) <= origin.radius;
}

function withFestivalDistance(item: TourItem, origin?: { x: number; y: number; radius: number }): DiscoverCandidate | null {
  const candidate = toCandidate(item, "festival");
  if (!candidate || !origin) return candidate;
  candidate.distanceMeters = haversineMeters(origin.x, origin.y, candidate.coordinates[0], candidate.coordinates[1]);
  return candidate;
}

export async function searchTourPlacesRemote(input: KakaoSearchInput): Promise<KakaoSearchResult> {
  const requestedPage = Math.min(45, Math.max(1, input.page ?? 1));
  const category = mappedCategory(input.category);
  const typeId = contentTypeId(category);
  const region = category === "festival" ? resolveFestivalRegion(input) : regionByQuery(input.region);
  const keyword = [input.region, input.query, input.mood].map(value => value?.trim() ?? "").filter(Boolean).join(" ").trim();
  const hasCoords = Number.isFinite(input.x) && Number.isFinite(input.y);
  const hasTypedQuery = Boolean(input.query?.trim() || input.mood?.trim());
  const rows = category === "festival" ? FESTIVAL_PAGE_SIZE : PAGE_SIZE;
  const origin = hasCoords
    ? { x: Number(input.x), y: Number(input.y), radius: Math.min(20000, Math.max(300, Math.round(input.radius ?? 2000))) }
    : undefined;
  const tokens = category === "festival" ? festivalSearchTokens(input, region) : [];
  const namedFestivalSearch = category === "festival" && tokens.length > 0 && !region && !hasCoords;

  const fetchPage = (pageNo: number) => {
    const common = { pageNo: String(pageNo), numOfRows: String(rows), contentTypeId: typeId };
    if (category === "festival" && !namedFestivalSearch) {
      return tourFetch("searchFestival2", {
        pageNo: String(pageNo),
        numOfRows: String(rows),
        eventStartDate: koreaTodayYmd(),
        lDongRegnCd: ldongRegnCdFromAreaCode(region?.areaCode),
        arrange: "C",
      });
    }
    if (hasCoords) {
      return tourFetch("locationBasedList2", {
        ...common,
        mapX: String(input.x),
        mapY: String(input.y),
        radius: String(origin?.radius ?? 2000),
        arrange: "E",
      });
    }
    if (keyword && (hasTypedQuery || !region)) {
      return tourFetch("searchKeyword2", {
        ...common,
        keyword: keyword.length >= 2 ? keyword : `${keyword} 여행`,
        areaCode: region ? String(region.areaCode) : "",
        sigunguCode: region?.sigunguCode ? String(region.sigunguCode) : "",
        arrange: "C",
      });
    }
    if (!region) {
      return Promise.resolve({ ok: false as const, code: "empty_query" as const, error: "지역을 고르거나 검색어를 입력해 주세요." });
    }
    return tourFetch("areaBasedList2", {
      ...common,
      areaCode: String(region.areaCode),
      sigunguCode: region.sigunguCode ? String(region.sigunguCode) : "",
      arrange: "Q",
    });
  };

  let pageNo = requestedPage;
  let fetched = await fetchPage(pageNo);
  if (!fetched.ok) return fetched;
  let totalCount = fetched.payload.response?.body?.totalCount ?? 0;
  let items = asItems(fetched.payload.response);
  if (category === "festival") {
    items = discoverFestivalItems(items).filter(item => festivalItemMatches(item, tokens, origin));
    let skipped = 0;
    while (items.length === 0 && pageNo * rows < totalCount && skipped < FESTIVAL_SKIP_EMPTY_PAGES) {
      pageNo += 1;
      skipped += 1;
      fetched = await fetchPage(pageNo);
      if (!fetched.ok) break;
      totalCount = fetched.payload.response?.body?.totalCount ?? totalCount;
      items = discoverFestivalItems(asItems(fetched.payload.response)).filter(item => festivalItemMatches(item, tokens, origin));
    }
    if (!fetched.ok) return fetched;
  }

  const places = items
    .map(item => (category === "festival" ? withFestivalDistance(item, origin) : toCandidate(item, category)))
    .filter((item): item is DiscoverCandidate => item !== null);
  return {
    ok: true,
    places,
    isEnd: pageNo * rows >= totalCount,
    page: pageNo,
    totalCount,
  };
}

export async function loadTourPlaceDetail(contentId: string, category: PlaceCategoryId): Promise<TourPlaceDetail | null> {
  const id = contentId.trim();
  if (!id) return null;
  const [common, intro, images] = await Promise.all([
    tourFetch("detailCommon2", { contentId: id }),
    tourFetch("detailIntro2", { contentId: id, contentTypeId: contentTypeId(category) }),
    tourFetch("detailImage2", { contentId: id }),
  ]);
  const commonItem = common.ok ? asItems(common.payload.response)[0] : undefined;
  const introItem = intro.ok ? asItems(intro.payload.response)[0] : undefined;
  const imageItem = images.ok ? asItems(images.payload.response)[0] : undefined;
  const overview = cleanText(commonItem?.overview);
  const image = commonItem?.firstimage || commonItem?.firstimage2 || imageItem?.originimgurl || imageItem?.firstimage;
  const openingHours = cleanText(introItem?.usetime || introItem?.playtime || ([introItem?.checkintime, introItem?.checkouttime].filter(Boolean).join(" – ")));
  const homepage = extractUrl(commonItem?.homepage) || extractUrl(introItem?.reservationurl);
  const facts = detailFacts(introItem, category);
  if (!overview && !image && !openingHours && !homepage && !facts.length) return null;
  return { overview, image, openingHours, homepage, facts };
}

/** One request per attraction for planning evidence; images and facilities are
 * fetched separately only when a detail view needs them. */
export async function loadTourPlaceOverview(contentId: string): Promise<string> {
  const id = contentId.trim();
  if (!id) return "";
  const result = await tourFetch("detailCommon2", { contentId: id });
  return result.ok ? cleanText(asItems(result.payload.response)[0]?.overview) : "";
}

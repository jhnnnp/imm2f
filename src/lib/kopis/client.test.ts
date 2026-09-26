import { afterEach, expect, it, vi } from "vitest";
import type { DiscoverCandidate } from "@/features/places/types/place";
import { attachKopisPerformances, findKopisPerformances, kopisFacilityMatches, kopisShowtimes } from "./client";

const venue: DiscoverCandidate = {
  externalSource: "kakao", externalPlaceId: "theater-1", name: "소월아트홀", category: "photo",
  categoryLabel: "공연장", detailedCategory: "문화,예술 > 공연장", district: "성동구",
  address: "서울 성동구 왕십리로 281", roadAddress: "서울 성동구 왕십리로 281",
  phone: "", mapUrl: "", coordinates: [127.04, 37.56],
};

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("matches a performance facility by exact identity and coordinate, never a nearby cafe", () => {
  const facility = { fcltynm: "소월아트홀", lo: "127.04", la: "37.56" };
  expect(kopisFacilityMatches(venue, "소월아트홀", facility)).toBe(true);
  expect(kopisFacilityMatches(venue, "소월아트홀 (성동문화회관) (소월아트홀)",
    { ...facility, fcltynm: "소월아트홀 (성동문화회관)" })).toBe(true);
  expect(kopisFacilityMatches({ ...venue, name: "할리스 소월아트홀점", category: "cafe" }, "소월아트홀", facility)).toBe(false);
  expect(kopisFacilityMatches(venue, "소월아트홀", { ...facility, lo: "127.07" })).toBe(false);
});

it("extracts only the requested weekday's published time", () => {
  expect(kopisShowtimes("화요일 ~ 금요일(20:00), 토요일(16:00,19:00), 일요일(15:00)", "20260924")).toEqual(["20:00"]);
  expect(kopisShowtimes("토요일(16:00,19:00)", "20260924")).toEqual([]);
  expect(kopisShowtimes("HOL(19:00)", "20261009", true)).toEqual(["19:00"]);
  expect(kopisShowtimes("HOL(19:00)", "20261009")).toEqual([]);
});

it("ties a dated performance to the exact verified facility", async () => {
  vi.stubEnv("KOPIS_SERVICE_KEY", "test-key");
  vi.stubGlobal("fetch", vi.fn(async (input: URL) => {
    const path = new URL(String(input)).pathname;
    const xml = path.endsWith("/pblprfr")
      ? "<dbs><db><mt20id>PF123456</mt20id><prfnm>작은 음악회</prfnm><fcltynm>소월아트홀</fcltynm><prfpdfrom>2026.09.01</prfpdfrom><prfpdto>2026.09.30</prfpdto></db></dbs>"
      : path.endsWith("/PF123456")
        ? "<dbs><db><mt20id>PF123456</mt20id><mt10id>FC123456</mt10id><fcltynm>소월아트홀</fcltynm><prfnm>작은 음악회</prfnm><genrenm>클래식</genrenm><dtguidance>목요일(20:00)</dtguidance></db></dbs>"
        : "<dbs><db><mt10id>FC123456</mt10id><fcltynm>소월아트홀</fcltynm><la>37.56</la><lo>127.04</lo></db></dbs>";
    return new Response(xml, { status: 200 });
  }));
  expect(await findKopisPerformances(venue, "20260924")).toMatchObject([{
    id: "PF123456", title: "작은 음악회", dateYmd: "20260924", showtimes: ["20:00"],
  }]);
});

it("checks later trip dates instead of only its first day", async () => {
  vi.stubEnv("KOPIS_SERVICE_KEY", "test-key");
  const datedVenue = { ...venue, externalPlaceId: "theater-trip" };
  vi.stubGlobal("fetch", vi.fn(async (input: URL) => {
    const url = new URL(String(input));
    const path = url.pathname;
    const xml = path.endsWith("/pblprfr")
      ? url.searchParams.get("stdate") === "20260926"
        ? "<dbs><db><mt20id>PF777777</mt20id><prfnm>여행 음악회</prfnm><fcltynm>소월아트홀</fcltynm><prfpdfrom>2026.09.26</prfpdfrom><prfpdto>2026.09.26</prfpdto></db></dbs>"
        : "<dbs/>"
      : path.endsWith("/PF777777")
        ? "<dbs><db><mt20id>PF777777</mt20id><mt10id>FC777777</mt10id><fcltynm>소월아트홀</fcltynm><prfnm>여행 음악회</prfnm><dtguidance>토요일(19:00)</dtguidance></db></dbs>"
        : "<dbs><db><mt10id>FC777777</mt10id><fcltynm>소월아트홀</fcltynm><la>37.56</la><lo>127.04</lo></db></dbs>";
    return new Response(xml, { status: 200 });
  }));
  const attached = await attachKopisPerformances([datedVenue], "2026-09-25", 2);
  expect(attached[0].performanceEvent?.dateYmd).toBe("20260926");
});

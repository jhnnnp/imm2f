import { describe, expect, it } from "vitest";
import {
  compactEventYmd,
  formatEventPeriod,
  festivalPeriodCoversYmd,
  isEndedFestival,
  isGenericFestivalQuery,
  koreaTodayYmd,
  ldongRegnCdFromAreaCode,
  shouldSearchFestivals,
} from "./festivalSchedule";

describe("festivalSchedule", () => {
  it("uses Korea calendar date instead of UTC", () => {
    const utcEvening = new Date("2026-09-17T16:30:00.000Z");
    expect(utcEvening.toISOString().slice(0, 10)).toBe("2026-09-17");
    expect(koreaTodayYmd(utcEvening)).toBe("20260918");
  });

  it("keeps festivals that end today and drops ones that already ended", () => {
    expect(isEndedFestival("20260901", "20260918", "20260918")).toBe(false);
    expect(isEndedFestival("20260901", "20260917", "20260918")).toBe(true);
    expect(isEndedFestival("20261001", "20261003", "20260918")).toBe(false);
    expect(isEndedFestival("20260801", "20260815", "20260918")).toBe(true);
  });

  it("treats missing dates as ended so stale list items are not shown", () => {
    expect(isEndedFestival(undefined, undefined, "20260918")).toBe(true);
    expect(isEndedFestival("20260901", "", "20260918")).toBe(true);
  });

  it("formats a compact YYYYMMDD period", () => {
    expect(compactEventYmd("2026-09-18")).toBe("20260918");
    expect(formatEventPeriod("20260901", "20260918")).toBe("2026.09.01 – 2026.09.18");
  });

  it("routes Kakao all/tourist queries about festivals onto the festival calendar", () => {
    expect(shouldSearchFestivals({ category: "all", query: "부산 축제" })).toBe(true);
    expect(shouldSearchFestivals({ category: "tourist", query: "벚꽃축제" })).toBe(true);
    expect(shouldSearchFestivals({ category: "festival", query: "" })).toBe(true);
    expect(shouldSearchFestivals({ category: "cafe", query: "축제 카페" })).toBe(false);
    expect(shouldSearchFestivals({ category: "all", query: "성수 카페" })).toBe(false);
  });

  it("maps legacy TourAPI area codes onto KorService2 legal-dong codes", () => {
    expect(ldongRegnCdFromAreaCode(1)).toBe("11");
    expect(ldongRegnCdFromAreaCode(6)).toBe("26");
    expect(ldongRegnCdFromAreaCode(32)).toBe("51");
    expect(ldongRegnCdFromAreaCode(37)).toBe("52");
    expect(isGenericFestivalQuery("축제")).toBe(true);
    expect(isGenericFestivalQuery("부산 축제")).toBe(false);
    expect(festivalPeriodCoversYmd("2026.09.18 – 2026.09.21", "20260918")).toBe(true);
    expect(festivalPeriodCoversYmd("2026.11.20 – 2027.03.28", "20260918")).toBe(false);
  });
});

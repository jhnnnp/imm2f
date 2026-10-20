import { describe, expect, it } from "vitest";
import { matchesPlaceRegion, resolvePlaceRegion, validKoreanVenueCoordinates } from "./regionScope";

describe("provider venue geography", () => {
  it("resolves qualified neighborhood aliases before their parent province", () => {
    expect(resolvePlaceRegion("서울 성수")?.query).toBe("성수동");
    expect(resolvePlaceRegion("부산 광안리")?.query).toBe("광안리");
    expect(resolvePlaceRegion("전주")?.areaCode).toBe(37);
  });
  it("rejects another city's branch and accepts local address abbreviations", () => {
    const local = { address: "서울 성동구 성수동", coordinates: [127.056, 37.544] as [number, number] };
    expect(matchesPlaceRegion(local, "서울시 성동구")).toBe(true);
    expect(matchesPlaceRegion(local, "서울 성수")).toBe(true);
    expect(matchesPlaceRegion({ address: "부산 수영구", coordinates: [129.1, 35.15] }, "서울 성수")).toBe(false);
    expect(matchesPlaceRegion({ address: "경기 안양시", coordinates: [126.9, 37.39] }, "성남시")).toBe(false);
  });
  it("never limits a province-wide request around its map center", () => {
    expect(matchesPlaceRegion({ address: "경기 연천군", coordinates: [127.08, 38.09] }, "경기")).toBe(true);
  });
  it("requires a custom locality's real address and distinguishes similarly named cities", () => {
    expect(matchesPlaceRegion({ address: "전남 담양군 담양읍", coordinates: [126.99, 35.32] }, "담양")).toBe(true);
    expect(matchesPlaceRegion({ address: "서울 종로구", coordinates: [126.98, 37.57] }, "담양")).toBe(false);
    expect(matchesPlaceRegion({ address: "경기 광주시", coordinates: [127.25, 37.41] }, "경기 광주")).toBe(true);
    expect(matchesPlaceRegion({ address: "광주광역시 서구", coordinates: [126.85, 35.15] }, "경기 광주")).toBe(false);
    expect(matchesPlaceRegion({ address: "광주광역시 서구", coordinates: [126.85, 35.15] }, "광주시")).toBe(false);
  });
  it("uses real addresses for regional aliases and permits explicit nearby broadening", () => {
    expect(matchesPlaceRegion({ address: "경기 양평군", coordinates: [127.49, 37.49] }, "양평")).toBe(true);
    const near = { address: "서울 강남구 압구정동", coordinates: [127.04, 37.526] as [number, number] };
    expect(matchesPlaceRegion(near, "성수 근처")).toBe(true);
  });
  it("rejects missing, swapped and zero provider coordinates", () => {
    expect(validKoreanVenueCoordinates([0, 0])).toBe(false);
    expect(validKoreanVenueCoordinates([37.5, 127])).toBe(false);
    expect(validKoreanVenueCoordinates([127, Number.NaN])).toBe(false);
    expect(validKoreanVenueCoordinates([126.5, 33.5])).toBe(true);
  });
});

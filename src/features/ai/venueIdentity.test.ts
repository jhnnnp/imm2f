import { expect, it } from "vitest";
import type { DiscoverCandidate } from "@/features/places/types/place";
import { deduplicateVenueBranches, sameVenueBranch } from "./venueIdentity";

const kakao: DiscoverCandidate = { externalSource: "kakao", externalPlaceId: "k", name: "식당 성수점", category: "restaurant",
  categoryLabel: "식당", district: "성수", address: "서울특별시 성동구 성수이로 10", roadAddress: "서울 성동구 성수이로 10",
  coordinates: [127.05, 37.54], phone: "02-123-4567", mapUrl: "https://place.map.kakao.com/k" };
const tour: DiscoverCandidate = { ...kakao, externalSource: "tourapi", externalPlaceId: "t", dishes: "파스타",
  factSourceUrl: "https://www.data.go.kr/data/15101578/openapi.do", evidence: [{ id: "t-menu", venueId: "tourapi:t",
    text: "대표 메뉴: 파스타", attribute: "menu", checkedAt: "2026-10-22", verification: "source_checked",
    url: "https://www.data.go.kr/data/15101578/openapi.do" }] };

it("combines matching provider branches while preserving a user-selected identity and official facts", () => {
  const merged = deduplicateVenueBranches([kakao, tour], ["kakao:k"]);
  expect(merged).toHaveLength(1);
  expect(merged[0]).toMatchObject({ externalSource: "kakao", externalPlaceId: "k", dishes: "파스타",
    evidence: [expect.objectContaining({ venueId: "kakao:k", verification: "source_checked" })] });
  expect(tour.evidence?.[0].venueId).toBe("tourapi:t");
});

it("never merges another branch, same-name nearby shop or incompatible experience", () => {
  expect(sameVenueBranch(kakao, { ...tour, name: "식당 홍대점" })).toBe(false);
  expect(sameVenueBranch(kakao, { ...tour, address: "서울 성동구 성수이로 12", roadAddress: "", phone: "02-222-3333" })).toBe(false);
  expect(sameVenueBranch(kakao, { ...tour, category: "cafe" })).toBe(false);
  expect(sameVenueBranch(kakao, { ...tour, coordinates: [127.08, 37.54] })).toBe(false);
});

it("keeps two explicitly selected source IDs for the feasibility boundary to inspect", () => {
  expect(deduplicateVenueBranches([kakao, tour], ["kakao:k", "tourapi:t"])).toHaveLength(2);
});

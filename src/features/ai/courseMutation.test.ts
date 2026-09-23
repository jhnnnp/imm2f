import { describe, expect, it } from "vitest";
import type { AIPlannerReply } from "@/features/planning/types/plan";
import { emptyDateBrief } from "./dateBrief";
import { courseMutationProblems } from "./courseMutation";

function plan(...places: Array<[string, string]>): AIPlannerReply {
  return { recommendations: places.map(([placeId, name]) => ({ placeId, name })) } as AIPlannerReply;
}

function typedPlan(...places: Array<[string, string, "meal" | "cafe" | "performance" | "exhibit"]>): AIPlannerReply {
  return { recommendations: places.map(([placeId, name, activitySlot]) => ({ placeId, name, activitySlot })) } as AIPlannerReply;
}

describe("course mutation transaction", () => {
  const before = plan(["kakao:hall", "소월아트홀"], ["kakao:meal", "칼국수집"], ["kakao:cafe", "정원 카페"]);

  it("accepts a one-for-one restaurant swap while preserving the other venue identities", () => {
    const state = { ...emptyDateBrief(), intent: "modify" as const, preserveExistingPlaces: true, excludedPlaces: ["칼국수집"] };
    const after = plan(["kakao:hall", "소월아트홀"], ["kakao:new-meal", "파스타집"], ["kakao:cafe", "정원 카페"]);
    expect(courseMutationProblems(before, after, state)).toEqual([]);
  });

  it("rejects a swap that quietly drops the cafe or changes the preserved hall ID", () => {
    const state = { ...emptyDateBrief(), intent: "modify" as const, preserveExistingPlaces: true, excludedPlaces: ["칼국수집"] };
    const after = plan(["kakao:other-hall", "소월아트홀"], ["kakao:new-meal", "파스타집"]);
    expect(courseMutationProblems(before, after, state)).toContain("기존 장소 누락: 소월아트홀");
    expect(courseMutationProblems(before, after, state)).toContain("기존 장소 누락: 정원 카페");
  });

  it("requires exactly one new stop for an addition", () => {
    const state = { ...emptyDateBrief(), intent: "modify" as const, preserveExistingPlaces: true, addStop: true };
    expect(courseMutationProblems(before, before, state)).toContain("일정 추가 수 불일치");
    const after = plan(["kakao:hall", "소월아트홀"], ["kakao:meal", "칼국수집"], ["kakao:cafe", "정원 카페"], ["kakao:gallery", "전시관"]);
    expect(courseMutationProblems(before, after, state)).toEqual([]);
  });

  it("rejects a cafe in the restaurant slot even when the place count is unchanged", () => {
    const old = typedPlan(["kakao:meal", "식당", "meal"], ["kakao:hall", "소월아트홀", "performance"]);
    const next = typedPlan(["kakao:cafe", "카페", "cafe"], ["kakao:hall", "소월아트홀", "performance"]);
    const state = { ...emptyDateBrief(), intent: "modify" as const, excludedPlaces: ["식당"] };
    expect(courseMutationProblems(old, next, state)).toContain("장소 교체 역할 불일치");
  });

  it("rejects a repeated cafe on generic addition but allows an explicit cafe tour", () => {
    const old = typedPlan(["kakao:meal", "식당", "meal"], ["kakao:cafe", "카페", "cafe"]);
    const next = typedPlan(["kakao:meal", "식당", "meal"], ["kakao:cafe", "카페", "cafe"], ["kakao:cafe2", "다른 카페", "cafe"]);
    const state = { ...emptyDateBrief(), intent: "modify" as const, addStop: true, userRequests: ["일정추가"] };
    expect(courseMutationProblems(old, next, state)).toContain("일정 추가 경험 중복: cafe");
    expect(courseMutationProblems(old, next, { ...state, userRequests: ["카페 한 곳 더 추가해줘"] })).toEqual([]);
  });

  it("keeps the existing course when a cafe swap creates a large detour", () => {
    const old = { ...typedPlan(["kakao:meal", "식당", "meal"], ["kakao:cafe", "카페", "cafe"], ["kakao:hall", "공연장", "performance"]),
      design: { routeBasis: "straight_line" as const, totalDistanceMeters: 402 } };
    const next = { ...typedPlan(["kakao:meal", "식당", "meal"], ["kakao:new", "먼 카페", "cafe"], ["kakao:hall", "공연장", "performance"]),
      design: { routeBasis: "straight_line" as const, totalDistanceMeters: 3100 } };
    const state = { ...emptyDateBrief(), intent: "modify" as const, excludedPlaces: ["카페"] };
    expect(courseMutationProblems(old, next, state)).toContain("교체로 동선이 크게 늘어남");
    expect(courseMutationProblems(old, next, { ...state, areaScope: "nearby" })).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import type { DiscoverCandidate } from "@/features/places/types/place";
import { buildCandidateGraph, repeatedComplexDays } from "./candidateGraph";
import { emptyDateBrief } from "./dateBrief";
import { buildFallbackCourse, evaluateCourse } from "./courseDesign";
import { verifiedOpeningAtVisit } from "./planningEvidence";
import { repairAffectedStop, preservesUnchangedDays } from "./targetedCourseRepair";

const venue = (id: string, name: string, lng: number, category: DiscoverCandidate["category"] = "restaurant"): DiscoverCandidate => ({
  externalSource: "kakao", externalPlaceId: id, name, category,
  categoryLabel: category === "restaurant" ? "음식점" : "관광명소", district: "기장군",
  address: "부산 기장군 기장읍", roadAddress: "", phone: "", mapUrl: `https://place.map.kakao.com/${id}`,
  coordinates: [lng, 35.19],
});

describe("candidate graph and targeted repair", () => {
  const outletMeal = venue("one", "미림양장 롯데아울렛 동부산점", 129.212);
  const otherOutletMeal = venue("two", "리미니 롯데프리미엄아울렛 동부산점", 129.213);
  const park = venue("park", "기장 해안공원", 129.205, "nature");
  const replacement = venue("meal", "동네 식당", 129.21);
  const anotherMeal = venue("other", "해변 식당", 129.211);

  it("links only corroborated named facilities and records provider evidence", () => {
    const graph = buildCandidateGraph([outletMeal, otherOutletMeal, park]);
    expect(graph.relations).toHaveLength(1);
    expect(graph.relations[0].candidateIds).toEqual(["kakao:one", "kakao:two"]);
    expect(graph.relations[0].evidence.map(item => item.text)).toEqual([outletMeal.name, otherOutletMeal.name]);
    expect(buildCandidateGraph([venue("a", "카페 하나", 129.212, "cafe"),
      venue("b", "카페 둘", 129.212, "cafe")]).relations).toHaveLength(0);
    const named = { ...outletMeal, roadAddress: "부산 기장군 기장읍 동부산관광로 147" };
    const unnamed = { ...replacement, roadAddress: named.roadAddress };
    expect(buildCandidateGraph([named, unnamed]).relations[0]).toMatchObject({
      complexKey: "롯데아울렛동부산점", evidence: [{ source: "provider_name" }, { source: "provider_address" }],
    });
    const unnamedTwo = { ...anotherMeal, roadAddress: named.roadAddress };
    expect(buildCandidateGraph([named, unnamed, unnamedTwo]).relations.some(relation =>
      relation.candidateIds.join("|") === "kakao:meal|kakao:other"
      && relation.evidence.some(item => item.candidateId === "kakao:one"))).toBe(true);
    const sourced = { ...replacement, evidence: [{ id: "complex", venueId: "kakao:meal",
      verification: "source_checked" as const, text: "롯데아울렛 동부산점 내부 식당",
      url: "https://example.com/place", checkedAt: "2026-09-29" }] };
    expect(buildCandidateGraph([outletMeal, sourced]).relations[0].evidence
      .some(item => item.source === "source_checked_observation")).toBe(true);
  });

  it("rejects a second-day visit to the same complex and changes only that day", () => {
    const candidates = [outletMeal, otherOutletMeal, park, replacement, anotherMeal];
    const graph = buildCandidateGraph(candidates);
    const rows = [
      { id: "kakao:one", day_index: 0, duration_minutes: 60 },
      { id: "kakao:park", day_index: 0, duration_minutes: 60 },
      { id: "kakao:two", day_index: 1, duration_minutes: 60 },
      { id: "kakao:meal", day_index: 1, duration_minutes: 60 },
    ];
    expect(repeatedComplexDays(rows, graph)).toHaveLength(1);
    const state = { ...emptyDateBrief(), stayKind: "overnight" as const, nights: 1 };
    const course = evaluateCourse({ theme: "", rows }, candidates, state, new Set(), { candidateGraph: graph });
    expect(course.hardIssues.map(issue => issue.code)).toContain("repeated_complex_day");
    const repaired = repairAffectedStop(course, candidates, state, new Set(), { candidateGraph: graph });
    expect(repaired?.hardIssues.map(issue => issue.code)).not.toContain("repeated_complex_day");
    expect(repaired && preservesUnchangedDays(course.rows, repaired.rows, new Set([1]))).toBe(true);
  });

  it("requires the exact selected ID even when another venue has the same name", () => {
    const a = venue("a", "같은 이름", 129.2);
    const b = venue("b", "같은 이름", 129.201);
    const course = evaluateCourse({ theme: "", rows: [{ id: "kakao:b", day_index: 0 }] },
      [a, b], emptyDateBrief(), new Set(), { anchorIds: ["kakao:a"] });
    expect(course.hardIssues.map(issue => issue.code)).toContain("selected_anchor_missing");
    const seeded = buildFallbackCourse([a, b, park], emptyDateBrief(), new Set(),
      { anchorIds: ["kakao:a"] });
    expect(seeded.rows.map(row => row.id)).toContain("kakao:a");
  });

  it("rejects a scheduled visit only when exact, recent hours confirm closure", () => {
    const checked = { ...replacement, evidence: [{ id: "hours", attribute: "hours" as const,
      venueId: "kakao:meal", verification: "source_checked" as const,
      text: "매일 10:00~12:00", url: "https://example.com/hours", checkedAt: new Date().toISOString() }] };
    const unverified = { ...checked, evidence: checked.evidence.map(item =>
      ({ ...item, verification: "search_report" as const })) };
    expect(verifiedOpeningAtVisit(checked, "20260929", "14:00", 60)).toBe("closed");
    expect(verifiedOpeningAtVisit(unverified, "20260929", "14:00", 60)).toBe("unknown");
    const state = { ...emptyDateBrief(), dateLabel: "2026-09-29" };
    const result = evaluateCourse({ theme: "", rows: [
      { id: "kakao:meal", day_index: 0, duration_minutes: 60 },
      { id: "kakao:park", day_index: 0, duration_minutes: 60 },
    ] }, [checked, park], state, new Set());
    expect(result.hardIssues.map(issue => issue.code)).toContain("confirmed_closed");
  });
});

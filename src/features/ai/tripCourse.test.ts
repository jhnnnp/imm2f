import { describe, expect, it } from "vitest";
import type { DiscoverCandidate } from "@/features/places/types/place";
import type { AIPlannerReply } from "@/features/planning/types/plan";
import { courseSize, emptyDateBrief, tripDayYmd, withAreas } from "./dateBrief";
import { buildFallbackCourse, evaluateCourse, hardCourseProblems } from "./courseDesign";
import { courseMutationProblems } from "./courseMutation";
import { assignStartTimes } from "./dateCourse";

function place(id: string, category: DiscoverCandidate["category"], offset = 0): DiscoverCandidate {
  return { externalSource: "kakao", externalPlaceId: id, name: id, category, categoryLabel: category,
    district: "군산", address: "", roadAddress: "", phone: "", mapUrl: "", coordinates: [126.7 + offset * 0.002, 35.97] };
}

const trip = () => ({ ...withAreas(emptyDateBrief(), ["군산"]), stayKind: "overnight" as const,
  nights: 1, dateLabel: "2026-09-25", discovery: { themes: [], priorities: [], queries: [],
    transport: "transit" as const, requiredActivities: [], activityOrder: [], minStops: 4, maxStops: 8 } });

describe("traveler's itinerary checks", () => {
  it("rejects a sparse three-day trip even if discovery asked for only four stops", () => {
    const state = { ...trip(), nights: 2, discovery: { ...trip().discovery, minStops: 4, maxStops: 4 } };
    const venues = [place("attraction", "tourist"), place("lunch", "restaurant", 1),
      place("cafe", "cafe", 2), place("dinner", "restaurant", 3)];
    const rows = venues.map((venue, index) => ({ id: `kakao:${venue.externalPlaceId}`, day_index: index < 2 ? 0 : index === 2 ? 1 : 2 }));
    const problems = hardCourseProblems(evaluateCourse({ theme: "", rows }, venues, state, new Set()).problems);
    expect(courseSize(state).min).toBe(8);
    expect(problems).toContain("요청에 맞지 않는 장소 수");
    expect(problems).toContain("2일차 일정 부족");
    expect(problems).toContain("3일차 일정 부족");
  });
  it("advances calendar dates across month and year boundaries", () => {
    expect(tripDayYmd({ dateLabel: "2026-12-31" }, 1)).toBe("20270101");
  });

  it("respects explicitly stated first-day arrival and last-day departure", () => {
    const venues = [place("first", "tourist"), place("lunch", "restaurant", 1),
      place("second", "nature", 2), place("meal", "restaurant", 3)];
    const rows = venues.map((venue, index) => ({ id: `kakao:${venue.externalPlaceId}`, day_index: index < 2 ? 0 : 1 }));
    const state = { ...trip(), userRequests: ["첫날 오후 2시 도착, 둘째 날 오후 5시 출발"] };
    const scheduled = assignStartTimes(rows, venues, state);
    expect(scheduled[0]?.start_time).toBe("14:00");
    const last = scheduled.at(-1)!;
    const finish = Number(last.start_time!.slice(0, 2)) * 60 + Number(last.start_time!.slice(3)) + last.duration_minutes!;
    expect(finish).toBeLessThanOrEqual(17 * 60);
  });

  it("assigns a festival only to an eligible travel day", () => {
    const venues = [place("meal", "restaurant"), place("walk", "nature", 1),
      { ...place("festival", "festival", 2), openingHours: "2026.09.26 – 2026.09.26" },
      place("cafe", "cafe", 3)];
    const rows = venues.map((venue, index) => ({ id: `kakao:${venue.externalPlaceId}`, day_index: index < 2 ? 0 : 1 }));
    const valid = evaluateCourse({ theme: "", rows }, venues, trip(), new Set());
    expect(valid.problems).not.toContain("2일차 축제 날짜 불일치");
    const wrong = evaluateCourse({ theme: "", rows: rows.map((row, index) => ({ ...row, day_index: index === 1 ? 1 : index === 2 ? 0 : row.day_index })) }, venues, trip(), new Set());
    expect(hardCourseProblems(wrong.problems)).toContain("1일차 축제 날짜 불일치");
  });

  it("anchors a second-day performance to its verified showtime", () => {
    const show = { ...place("stage", "photo", 3), name: "군산 공연장", categoryLabel: "공연장",
      detailedCategory: "문화,예술 > 공연장", performanceEvent: { id: "PF123", title: "음악회",
        dateYmd: "20260926", showtimes: ["19:00"], genre: "음악", sourceUrl: "https://example.com/show",
        checkedAt: "2026-09-25" } };
    const venues = [place("walk", "tourist"), place("meal1", "restaurant", 1), place("meal2", "restaurant", 2), show];
    const rows = venues.map((venue, index) => ({ id: `kakao:${venue.externalPlaceId}`, day_index: index < 2 ? 0 : 1 }));
    const scheduled = assignStartTimes(rows, venues, trip());
    expect(scheduled.find(row => row.id === "kakao:stage")?.start_time).toBe("19:00");
    const wrongDay = rows.map((row, index) => ({ ...row, day_index: index === 0 ? 1 : index === 3 ? 0 : row.day_index }));
    expect(hardCourseProblems(evaluateCourse({ theme: "", rows: wrongDay }, venues, trip(), new Set()).problems))
      .toContain("1일차 공연 날짜 불일치");
  });

  it("rejects five stops packed into one travel day", () => {
    const venues = [place("a", "tourist"), place("b", "restaurant", 1), place("c", "cafe", 2),
      place("d", "nature", 3), place("e", "photo", 4), place("f", "tourist", 5)];
    const rows = venues.map((venue, index) => ({ id: `kakao:${venue.externalPlaceId}`, day_index: index < 5 ? 0 : 1 }));
    expect(hardCourseProblems(evaluateCourse({ theme: "", rows }, venues, trip(), new Set()).problems))
      .toContain("1일차 장소 과밀");
  });

  it("does not present a restaurant-and-cafe-only day as a full trip day", () => {
    const venues = [place("landmark", "tourist"), place("meal1", "restaurant", 1),
      place("meal2", "restaurant", 2), place("cafe", "cafe", 3)];
    const rows = venues.map((venue, index) => ({ id: `kakao:${venue.externalPlaceId}`, day_index: index < 2 ? 0 : 1 }));
    expect(hardCourseProblems(evaluateCourse({ theme: "", rows }, venues, trip(), new Set()).problems))
      .toContain("2일차 여행일 핵심 경험 누락");
    expect(evaluateCourse({ theme: "", rows }, venues, { ...trip(), userRequests: ["군산 미식 여행"] }, new Set()).problems)
      .not.toContain("2일차 여행일 핵심 경험 누락");
  });

  it("rejects an attraction-only name without an experience-specific source", () => {
    const venues = [place("landmark1", "tourist"), place("meal", "restaurant", 1),
      place("landmark2", "nature", 2), place("cafe", "cafe", 3)];
    const rows = venues.map((venue, index) => ({ id: `kakao:${venue.externalPlaceId}`, day_index: index < 2 ? 0 : 1 }));
    const problems = hardCourseProblems(evaluateCourse({ theme: "", rows }, venues, trip(), new Set()).problems);
    expect(problems).toEqual(expect.arrayContaining([
      "1일차 여행 핵심 장소 근거 부족", "2일차 여행 핵심 장소 근거 부족",
    ]));
  });

  it("can build a balanced two-day trip when each day has a sourced anchor", () => {
    const supported = (venue: DiscoverCandidate, text: string) => ({ ...venue, evidence: [{
      id: `${venue.externalPlaceId}:fact`, venueId: `kakao:${venue.externalPlaceId}`, text,
      url: "https://example.com/official", checkedAt: "2026-09-25",
    }] });
    const venues = [supported(place("historic", "tourist"), "역사적 건축과 전시 공간을 둘러볼 수 있습니다."),
      place("meal", "restaurant", 1),
      supported(place("garden", "nature", 2), "정원과 호수 주변 산책길이 있습니다."),
      place("cafe", "cafe", 3)];
    const fallback = buildFallbackCourse(venues, trip(), new Set());
    expect(hardCourseProblems(evaluateCourse(fallback, venues, trip(), new Set()).problems)).toEqual([]);
    expect(new Set(fallback.rows.map(row => row.day_index))).toEqual(new Set([0, 1]));
  });

  it("prefers a different second-day experience when both courses are feasible", () => {
    const supported = (venue: DiscoverCandidate, text: string) => ({ ...venue, evidence: [{
      id: `${venue.externalPlaceId}:fact`, venueId: `kakao:${venue.externalPlaceId}`, text,
      url: "https://example.com/official", checkedAt: "2026-09-25",
    }] });
    const historic = supported(place("historic", "tourist"), "역사적 건축물을 둘러볼 수 있다.");
    const similar = supported(place("similar", "tourist", 1), "역사적 건축물을 둘러볼 수 있다.");
    const coast = supported({ ...place("coast", "nature", 30), name: "해안 산책로" }, "바다 풍경을 따라 걷는 산책로가 있다.");
    const meal = place("meal", "restaurant", 2);
    const cafe = place("cafe", "cafe", 31);
    const venues = [historic, similar, coast, meal, cafe];
    const proposal = (second: DiscoverCandidate) => ({ theme: "", rows: [historic, meal, second, cafe]
      .map((candidate, index) => ({ id: `kakao:${candidate.externalPlaceId}`, day_index: index < 2 ? 0 : 1 })) });
    const repeated = evaluateCourse(proposal(similar), venues, trip(), new Set());
    const varied = evaluateCourse(proposal(coast), venues, trip(), new Set());
    expect(hardCourseProblems(varied.problems)).toEqual([]);
    expect(varied.score).toBeGreaterThan(repeated.score);
  });

  it("plans a meal on each overnight day when enough restaurants are available", () => {
    const supported = (venue: DiscoverCandidate) => ({ ...venue, evidence: [{
      id: `${venue.externalPlaceId}:fact`, venueId: `kakao:${venue.externalPlaceId}`,
      text: "역사적 건축과 전시 공간을 둘러볼 수 있다.", url: "https://example.com/official", checkedAt: "2026-09-25",
    }] });
    const venues = [supported(place("a", "tourist")), supported(place("b", "tourist", 8)),
      place("meal1", "restaurant", 1), place("meal2", "restaurant", 9), place("cafe", "cafe", 2)];
    const poor = { theme: "", rows: [venues[0], venues[2], venues[1], venues[4]].map((candidate, index) => ({
      id: `kakao:${candidate.externalPlaceId}`, day_index: index < 2 ? 0 : 1,
    })) };
    expect(hardCourseProblems(evaluateCourse(poor, venues, trip(), new Set()).problems)).toContain("2일차 여행일 식사 누락");
    const fallback = buildFallbackCourse(venues, trip(), new Set());
    expect(hardCourseProblems(evaluateCourse(fallback, venues, trip(), new Set()).problems)).toEqual([]);
    for (const day of [0, 1]) expect(fallback.rows.filter(row => row.day_index === day)
      .some(row => row.id?.startsWith("kakao:meal"))).toBe(true);
  });

  it("keeps each saved stop on its original day during a venue edit", () => {
    const previous = { recommendations: [{ placeId: "a", name: "a" }, { placeId: "b", name: "b" }],
      items: [{ dayIndex: 0 }, { dayIndex: 1 }] } as AIPlannerReply;
    const changed = { recommendations: [{ placeId: "a", name: "a" }, { placeId: "b", name: "b" }],
      items: [{ dayIndex: 1 }, { dayIndex: 0 }] } as AIPlannerReply;
    const state = { ...trip(), intent: "modify" as const, preserveExistingPlaces: true };
    expect(courseMutationProblems(previous, changed, state)).toContain("기존 장소 일차 변경");
    expect(courseMutationProblems(previous, changed, { ...state, userRequests: ["첫날과 둘째 날 장소를 바꿔줘"] }))
      .not.toContain("기존 장소 일차 변경");
  });
});

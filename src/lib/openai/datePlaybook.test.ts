import { describe, expect, it } from "vitest";
import type { AIPlannerState } from "@/features/planning/types/plan";
import { DATE_PLAYBOOK, datePlaybookTags, selectDatePlaybook } from "./datePlaybook";

const state = (overrides: Partial<AIPlannerState> = {}): AIPlannerState => ({
  activities: [], areas: ["왕십리"], region: "왕십리", regions: ["왕십리"],
  areaScope: "core", requiredPlaces: [], excludedPlaces: [], cuisine: null,
  indoorPlay: null, pace: "balanced", stayKind: "date", nights: 0,
  timeWindow: null, startTime: null, endTime: null, dateLabel: null,
  pinOrder: [], preserveExistingPlaces: false, addStop: false,
  intent: "create", pendingSlot: null, conversationNotes: [], ...overrides,
});

describe("date-planning playbook retrieval", () => {
  it("does not turn a disliked cafe into a requested cafe", () => {
    expect(datePlaybookTags("카페는 별로 안 좋아하는데 조용한 곳 가고 싶어", state()).has("cafe")).toBe(false);
  });
  it("keeps photo and quiet context even without a named activity", () => {
    const tags = datePlaybookTags("여자친구가 사진 찍는 걸 좋아해. 조용한 곳이면 좋겠어", state());
    expect(selectDatePlaybook(DATE_PLAYBOOK, tags, "discovery", 10).map(card => card.id))
      .toEqual(expect.arrayContaining(["photo-date-search", "quiet-conversation-search"]));
  });
  it("selects relationship and creative policies for the matching request", () => {
    const first = datePlaybookTags("첫 데이트에 도자기 공방 가고 싶어", state());
    expect(selectDatePlaybook(DATE_PLAYBOOK, first, "discovery", 20).map(card => card.id))
      .toEqual(expect.arrayContaining(["first-date-pacing", "creative-activity"]));
    const birthday = datePlaybookTags("여자친구 생일에 조용히 만나고 싶어", state());
    expect(selectDatePlaybook(DATE_PLAYBOOK, birthday, "selection", 20).map(card => card.id))
      .toContain("occasion-personalization");
  });
  it("loads whole-utterance and conversation rules before itinerary planning", () => {
    const tags = datePlaybookTags("부산여행갈래", state({ areas: [], region: "", regions: [], stayKind: null }));
    expect(selectDatePlaybook(DATE_PLAYBOOK, tags, "interpretation", 4).map(card => card.id))
      .toEqual(expect.arrayContaining(["interpret-whole-utterance", "interpret-conversation-context", "interpret-grounded-slots"]));
  });
  it("retrieves experience and cafe-space strategy for a specific date request", () => {
    const tags = datePlaybookTags("내일 왕십리에서 공연 보고 예쁜 카페 가고 싶어", state());
    const discovery = selectDatePlaybook(DATE_PLAYBOOK, tags, "discovery");
    expect(discovery.map(card => card.id)).toEqual(expect.arrayContaining([
      "experience-anchor", "event-is-not-venue", "cafe-space-search",
    ]));
    const selection = selectDatePlaybook(DATE_PLAYBOOK, tags, "selection", 6);
    expect(selection.map(card => card.id)).toContain("cafe-space-evidence");
    expect(selection.map(card => card.id)).toContain("date-event-validity");
  });

  it("retrieves the edit contract for schedule additions", () => {
    const tags = datePlaybookTags("일정추가", state({ intent: "modify", addStop: true }));
    expect(selectDatePlaybook(DATE_PLAYBOOK, tags, "editing").map(card => card.id))
      .toContain("add-new-experience");
  });

  it("does not retrieve inactive cards or cards from another stage", () => {
    const tags = datePlaybookTags("카페 변경", state({ intent: "modify" }));
    const cards = selectDatePlaybook([
      ...DATE_PLAYBOOK,
      { ...DATE_PLAYBOOK[0], id: "retired", active: false, priority: 100 },
    ], tags, "editing");
    expect(cards.map(card => card.id)).toContain("swap-contract");
    expect(cards.map(card => card.id)).not.toContain("retired");
    expect(cards.every(card => card.stage === "editing")).toBe(true);
  });
  it("requires the complete context for a specific recipe", () => {
    const mealOnly = datePlaybookTags("왕십리에서 파스타 먹고 싶어", state({ activities: ["meal"] }));
    const mealCards = selectDatePlaybook(DATE_PLAYBOOK, mealOnly, "discovery").map(card => card.id);
    expect(mealCards).toContain("food-destination-recipe");
    expect(mealCards).not.toContain("performance-evening-recipe");
    expect(mealCards).not.toContain("cafe-destination-recipe");
    const cafeOnly = datePlaybookTags("왕십리 카페", state({ activities: ["cafe"] }));
    expect(selectDatePlaybook(DATE_PLAYBOOK, cafeOnly, "discovery").map(card => card.id))
      .not.toContain("cafe-destination-recipe");
  });
  it("requires both a date and cultural activity for event validation", () => {
    const dinnerDate = datePlaybookTags("내일 저녁", state({ activities: ["meal"], dateLabel: "2026-09-26" }));
    expect(selectDatePlaybook(DATE_PLAYBOOK, dinnerDate, "selection", 10).map(card => card.id))
      .not.toContain("date-event-validity");
    const performanceDate = datePlaybookTags("내일 공연", state({ activities: ["performance"], dateLabel: "2026-09-26" }));
    expect(selectDatePlaybook(DATE_PLAYBOOK, performanceDate, "selection", 10).map(card => card.id))
      .toContain("date-event-validity");
  });
  it("uses structured edit state when the user says only 'that one'", () => {
    const tags = datePlaybookTags("그걸로 바꿔줘", state({ intent: "modify", excludedPlaces: ["기존 카페"] }));
    expect(selectDatePlaybook(DATE_PLAYBOOK, tags, "editing").map(card => card.id)).toContain("swap-contract");
  });
  it("retrieves trip strategy for day trips and overnight trips, but not local dates", () => {
    const local = datePlaybookTags("성수 데이트", state());
    expect(selectDatePlaybook(DATE_PLAYBOOK, local, "discovery", 10).map(card => card.id)).not.toContain("trip-day-clusters");
    const daytrip = datePlaybookTags("포천 당일치기", state({ areas: ["포천"], stayKind: "daytrip" }));
    expect(selectDatePlaybook(DATE_PLAYBOOK, daytrip, "discovery", 10).map(card => card.id))
      .toEqual(expect.arrayContaining(["trip-experience-anchor", "trip-day-clusters", "trip-arrival-departure"]));
    const overnight = datePlaybookTags("군산 1박2일", state({ areas: ["군산"], stayKind: "overnight", nights: 1 }));
    expect(selectDatePlaybook(DATE_PLAYBOOK, overnight, "response", 4).map(card => card.id)).toContain("trip-stay-contract");
  });
});

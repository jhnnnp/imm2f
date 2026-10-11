import { beforeEach, describe, expect, it, vi } from "vitest";
import { completeJson } from "./client";
import { generatePlanOptionsWithOpenAi, type PlanPlaceInput } from "./generatePlan";
import type { PlanOption } from "@/features/planning/types/plan";

vi.mock("./client", () => ({ completeJson: vi.fn() }));
vi.mock("./env", () => ({ isOpenAiConfigured: () => true }));
beforeEach(() => { vi.mocked(completeJson).mockReset(); });

const places: PlanPlaceInput[] = [
  { id: "first", name: "저장한 카페", categoryLabel: "카페", district: "서울", durationMinutes: 120,
    expectedCostTwo: 20000, userStatus: "want", partnerStatus: "want" },
  { id: "second", name: "저장한 공원", categoryLabel: "공원", district: "서울", durationMinutes: 120,
    expectedCostTwo: 0, userStatus: "want", partnerStatus: "want" },
];
const generated = (modify?: (row: Record<string, unknown>, style: string) => void) => ({ options:
  ["balanced", "relaxed"].map((style, index) => ({ style, items: places.map(place => {
    const row: Record<string, unknown> = { place_id: place.id, start_time: "15:00", duration_minutes: [120, 90, 40][index], memo: "" };
    modify?.(row, style);
    return row;
  }) })) });
const signature = (option: PlanOption) => option.items.map(item => `${item.placeId}:${item.durationMinutes}`).join("|");
const minutesOf = (value: string) => { const [h, m] = value.split(":").map(Number); return h * 60 + m; };

describe("AI plan option consistency", () => {
  it("preserves verified place data and rejects malformed display fields and durations", async () => {
    vi.mocked(completeJson).mockResolvedValue(generated((row, style) => {
      row.memo = { invented: "예약 완료" };
      if (style === "balanced") row.duration_minutes = null;
      row.start_time = { hour: 23 };
    }));
    const result = await generatePlanOptionsWithOpenAi({ kind: "date", prompt: "저장한 장소로 제안해줘", places });
    expect("options" in result).toBe(true);
    if (!("options" in result)) return;
    expect(result.options).toHaveLength(2);
    expect(result.options[0].items.map(item => item.durationMinutes)).toEqual([120, 120]);
    for (const option of result.options) {
      expect(option.items[0].startTime).toBe("15:00");
      expect(option.items.map(item => item.memo)).toEqual(["", ""]);
      expect(option.items.map(item => item.placeName)).toEqual(places.map(place => place.name));
      expect(option.totalCost).toBe(0);
    }
  });

  it.each([false, "", "30"])("does not coerce provider duration %s into a shortened visit", async duration => {
    vi.mocked(completeJson).mockResolvedValue(generated((row, style) => { if (style === "balanced") row.duration_minutes = duration; }));
    const result = await generatePlanOptionsWithOpenAi({ kind: "date", prompt: "제안해줘", places });
    expect("options" in result).toBe(true);
    if (!("options" in result)) return;
    expect(result.options.find(option => option.style === "balanced")?.items.map(item => item.durationMinutes))
      .toEqual([120, 120]);
  });

  it.each(["23:30", "22:00"])("replaces a proposal that would wrap midnight at %s with valid day plans", async time => {
    vi.mocked(completeJson).mockResolvedValue(generated(row => { row.start_time = time; }));
    const result = await generatePlanOptionsWithOpenAi({ kind: "date", prompt: "제안해줘", places });
    expect("options" in result).toBe(true);
    if (!("options" in result)) return;
    expect(result.note).toContain("저장한 장소를 바탕으로");
    for (const option of result.options) {
      let previousEnd = -1;
      for (const item of option.items) {
        expect(minutesOf(item.startTime)).toBeGreaterThan(previousEnd);
        previousEnd = minutesOf(item.startTime) + item.durationMinutes;
        expect(previousEnd).toBeLessThan(1440);
        expect(item.dayIndex).toBe(0);
      }
    }
  });

  it("omits prices from the model and produces only pace-based options", async () => {
    vi.mocked(completeJson).mockResolvedValue(generated());
    const result = await generatePlanOptionsWithOpenAi({ kind: "date", prompt: "제안해줘",
      places: [{ ...places[0], expectedCostTwo: null }, places[1]] });
    expect("options" in result).toBe(true);
    if (!("options" in result)) return;
    expect(result.options.map(option => option.style)).toEqual(["balanced", "relaxed"]);
    expect(result.options.map(option => option.totalCost)).toEqual([0, 0]);
    expect(result.note).not.toContain("비용");
    expect(vi.mocked(completeJson).mock.calls[0][0].messages[1].content).not.toContain("expectedCostTwo");
  });

  it("removes duplicate fallback options and reports the actual option count", async () => {
    vi.mocked(completeJson).mockResolvedValue(null);
    const result = await generatePlanOptionsWithOpenAi({ kind: "date", prompt: "제안해줘",
      places: places.map(place => ({ ...place, durationMinutes: 60, expectedCostTwo: 10000 })) });
    expect("options" in result).toBe(true);
    if (!("options" in result)) return;
    expect(result.options).toHaveLength(2);
    expect(new Set(result.options.map(signature)).size).toBe(result.options.length);
    expect(result.note).toContain("2안을");
    expect(result.note).not.toContain("3안");
  });

  it("never includes a saved venue that either partner rejected", async () => {
    const rejected = { ...places[0], id: "rejected", name: "제외한 장소", partnerStatus: "dislike" };
    vi.mocked(completeJson).mockResolvedValue(generated());
    const result = await generatePlanOptionsWithOpenAi({ kind: "date", prompt: "제안해줘", places: [...places, rejected] });
    expect("options" in result).toBe(true);
    if (!("options" in result)) return;
    expect(result.options.flatMap(option => option.items.map(item => item.placeId))).not.toContain("rejected");
    expect(vi.mocked(completeJson).mock.calls[0][0].messages[1].content).not.toContain("제외한 장소");
  });
});

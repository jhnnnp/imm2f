import { describe, expect, it } from "vitest";
import { emptyDateBrief } from "./dateBrief";
import { applyDateMemory, collectDateMemory } from "./dateMemory";
import type { TasteBoard } from "@/features/taste/types";
import type { ArchivedDatePlan } from "@/features/planning/actions";

const taste: TasteBoard = { you: null, partner: null, youName: "나", partnerName: "상대", partnerConnected: false, compare: null };

describe("date memory", () => {
  it("uses archived and current-turn feedback without making a venue mandatory", () => {
    const archives = [{ id: "a", title: "성수 데이트", date: "2026-09-01", notes: "카페 A는 좋았는데 사람이 너무 많았어",
      items: [{ placeName: "카페 A" }] }] as ArchivedDatePlan[];
    const memory = collectDateMemory({ taste, archives, userRequests: [], currentPlaces: [] });
    expect(memory.episodes).toEqual([
      expect.objectContaining({ placeName: "카페 A", reaction: "crowded", source: "archive" }),
      expect.objectContaining({ placeName: "카페 A", reaction: "liked", source: "archive" }),
    ]);
    const state = applyDateMemory(emptyDateBrief(), memory);
    expect(state.preferences?.crowdTolerance).toBeLessThan(0.4);
    expect(state.requiredPlaces).toEqual([]);
    expect(state.inferredPreferences?.[0].evidence).toContain("사람이 너무 많았어");
  });
});

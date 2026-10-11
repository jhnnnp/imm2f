import { beforeEach, describe, expect, it, vi } from "vitest";
import { completeJson } from "./client";
import { proposePlanEditsWithOpenAi, type PlanEditItemInput } from "./editPlan";

vi.mock("./client", () => ({ completeJson: vi.fn() }));
vi.mock("./env", () => ({ isOpenAiConfigured: () => true }));
beforeEach(() => { vi.mocked(completeJson).mockReset(); });

const items: PlanEditItemInput[] = [
  { id: "first", placeName: "저장한 카페", category: "카페", startTime: "15:00", durationMinutes: 60, expectedCost: 10000 },
  { id: "second", placeName: "저장한 공원", category: "공원", startTime: "16:20", durationMinutes: 60, expectedCost: 0 },
];

describe("AI plan edit validation", () => {
  it.each([null, false, "", "90", Number.NaN, Number.POSITIVE_INFINITY, -10, 0, 20, 35, 999])(
    "does not turn malformed duration %s into a real schedule change", async minutes => {
      vi.mocked(completeJson).mockResolvedValue({ changes: [{ type: "duration", itemId: "first", minutes }] });
      expect(await proposePlanEditsWithOpenAi({ kind: "date", prompt: "조금 더 오래 머물고 싶어요", items }))
        .toMatchObject({ changes: [] });
    },
  );

  it("keeps valid explicit edits, known ids and one change per item", async () => {
    vi.mocked(completeJson).mockResolvedValue({ changes: [
      { type: "duration", itemId: "unknown", minutes: 90 },
      { type: "duration", itemId: "first", minutes: 90 },
      { type: "remove", itemId: "first" },
    ] });
    expect(await proposePlanEditsWithOpenAi({ kind: "date", prompt: "카페에서 90분 머물고 싶어요", items }))
      .toMatchObject({ changes: [{ type: "duration", itemId: "first", minutes: 90 }] });
  });

  it("does not coerce a numeric provider id into a real string id", async () => {
    vi.mocked(completeJson).mockResolvedValue({ changes: [{ type: "duration", itemId: 123, minutes: 90 }] });
    expect(await proposePlanEditsWithOpenAi({ kind: "date", prompt: "더 오래 머물고 싶어요", items: [{ ...items[0], id: "123" }] }))
      .toMatchObject({ changes: [] });
  });

  it.each(["전부 머무는 시간을 늘려줘", "모두 90분씩 머물게 해줘", "전부 빼지 말고 한 곳만 제외해줘"])(
    "preserves at least one item without a clear all-removal request (%s)", async prompt => {
      vi.mocked(completeJson).mockResolvedValue({ changes: items.map(item => ({ type: "remove", itemId: item.id })) });
      const result = await proposePlanEditsWithOpenAi({ kind: "date", prompt, items });
      expect(result).toMatchObject({ changes: [{ type: "remove", itemId: "first" }] });
    },
  );

  it.each(["전부 삭제해줘", "일정 다 지워줘", "전체 일정을 비워줘"])("allows explicit clearing (%s)", async prompt => {
    vi.mocked(completeJson).mockResolvedValue({ changes: items.map(item => ({ type: "remove", itemId: item.id })) });
    const result = await proposePlanEditsWithOpenAi({ kind: "date", prompt, items });
    expect(result).toMatchObject({ changes: [{ type: "remove", itemId: "first" }, { type: "remove", itemId: "second" }] });
  });

  it("keeps the sole item for a duration request, but supports its explicit removal", async () => {
    vi.mocked(completeJson).mockResolvedValue({ changes: [{ type: "remove", itemId: "first" }] });
    expect(await proposePlanEditsWithOpenAi({ kind: "date", prompt: "전체 시간을 늘려줘", items: [items[0]] }))
      .toMatchObject({ changes: [] });
    expect(await proposePlanEditsWithOpenAi({ kind: "date", prompt: "이 장소를 빼줘", items: [items[0]] }))
      .toMatchObject({ changes: [{ type: "remove", itemId: "first" }] });
  });
});

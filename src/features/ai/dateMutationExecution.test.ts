import { describe, expect, it, vi } from "vitest";
import type { AIPlannerReply, AIPlannerResult, AIPlannerState } from "@/features/planning/types/plan";
import type { FootRoute } from "@/lib/routing/footRoute";
import { emptyDateBrief } from "./dateBrief";
import type { DateExecutionPlan, DateExecutionTask, DateExecutionTarget } from "./dateExecutionPlan";
import { buildVerifiedMutationTransaction, deterministicMutationTime, executeLimitedMutation,
  mutationCoverage } from "./dateMutationExecution";

const baseState: AIPlannerState = { ...emptyDateBrief(), region: "성수", regions: ["성수"], areas: ["성수"],
  dateLabel: "2026-09-26", startTime: "13:00", endTime: "23:00", timeWindow: "any" };
const ids = ["cafe-a", "dinner", "cafe-b"];
const names = ["첫 카페", "저녁 식당", "정원 카페"];
const itemTarget = (index: number): DateExecutionTarget => ({ kind: "plan_item", placeId: ids[index], name: names[index] });
const basePlan = (): AIPlannerReply => ({
  status: "plan", message: "기존 코스", card: { headline: "성수", lines: ["기존 코스"] },
  condition: { dateLabel: "2026-09-26", startTime: "13:00", endTime: "23:00", budget: 100000,
    region: "성수", timeSpecified: true },
  items: ids.map((id, index) => ({ id: `item-${id}`, placeId: id, placeName: names[index],
    category: index === 1 ? "식당" : "카페", startTime: ["13:00", "16:00", "18:00"][index],
    durationMinutes: 60, expectedCost: 10000, order: index, memo: "", dayIndex: 0,
    coordinates: [127.04 + index * 0.0003, 37.56] as [number, number] })),
  recommendations: ids.map((id, index) => ({ id, placeId: id, name: names[index],
    activitySlot: index === 1 ? "meal" as const : "cafe" as const,
    category: index === 1 ? "식당" : "카페", district: "성동구", address: "성수", phone: "", mapUrl: "",
    coordinates: [127.04 + index * 0.0003, 37.56] as [number, number], durationMinutes: 60,
    expectedCost: 10000, reasons: [], isSaved: false, distanceFromPreviousMeters: null })),
  candidateCount: 3, source: "fallback", state: baseState,
});
const task = (changes: NonNullable<DateExecutionTask["changes"]>, overrides: Partial<DateExecutionTask> = {}): DateExecutionTask => ({
  id: "task-1", type: "modify_itinerary", goal: "modify_itinerary", target: changes[0]?.target,
  changes, dependencies: [], executionOrder: 1, confidence: 0.9, status: "planned", source: "llm", ...overrides,
});
const change = (operation: NonNullable<DateExecutionTask["changes"]>[number]["operation"], index: number,
  extra: Partial<NonNullable<DateExecutionTask["changes"]>[number]> = {}) => ({
  operation, target: itemTarget(index), confidence: 0.9, ...extra,
});
const plan = (entry: DateExecutionTask): DateExecutionPlan => ({ tasks: [entry], unresolved: [],
  executable: true, source: "shadow_understanding" });
const route = { mode: "course" as const, confident: true };
const chat: AIPlannerResult = { status: "chat", message: "기존 경로 응답", card: {
  headline: "", lines: ["기존 경로 응답"] }, state: baseState };
const foot = vi.fn(async (coordinates: [number, number][]): Promise<FootRoute> => ({
  legs: Array.from({ length: coordinates.length - 1 }, () => ({ meters: 100, seconds: 300 })),
  meters: (coordinates.length - 1) * 100, seconds: (coordinates.length - 1) * 300, provider: "osm_foot",
}));
const input = (entry: DateExecutionTask, message: string, overrides: Record<string, unknown> = {}) => ({
  plan: plan(entry), currentPlan: basePlan(), primary: chat, route,
  interpreterMode: "assist" as const, executionMode: "limited" as const,
  userMessage: message, state: baseState, ...overrides,
});

describe("limited verified course mutation", () => {
  it("removes the verified second item through the existing editor", async () => {
    const result = await executeLimitedMutation(input(task([change("remove", 1)]), "두 번째 장소 빼줘"), foot);
    expect(result.taskResult?.failureCode).toBeUndefined();
    expect(result.taskResult).toMatchObject({ status: "success", operation: "remove",
      changedItemIds: ["item-dinner"], verificationPassed: true });
    expect(result.result.status).toBe("plan");
    if (result.result.status === "plan") expect(result.result.items.map(item => item.placeId))
      .toEqual(["cafe-a", "cafe-b"]);
  });

  it("does not run an unresolved or fabricated reference", async () => {
    const unresolved = await executeLimitedMutation(input(task([{ operation: "remove", confidence: 0.9 }]), "거기 빼줘"), foot);
    expect(unresolved.taskResult?.status).toBe("skipped");
    expect(unresolved.result).toBe(chat);
    const invented = await executeLimitedMutation(input(task([change("remove", 1, {
      target: { kind: "plan_item", name: "없는 식당", placeId: "invented" } })]), "저녁 식당 빼줘"), foot);
    expect(invented.taskResult?.status).toBe("skipped");
    expect(invented.result).toBe(chat);
  });

  it("keeps a named cafe as a protected item", () => {
    const built = buildVerifiedMutationTransaction(input(task([change("keep", 2)]), "카페는 그대로 둬"));
    expect(built && "transaction" in built && built.transaction.protectedItemIds).toEqual(["item-cafe-b"]);
  });

  it("rolls back when a KEEP-only legacy result changes the protected cafe", async () => {
    const before = basePlan();
    const changed: AIPlannerReply = { ...before,
      items: before.items.map((item, index) => index === 2 ? { ...item, id: "new-cafe-item",
        placeId: "new-cafe", placeName: "새 카페" } : item),
      recommendations: before.recommendations.map((place, index) => index === 2
        ? { ...place, id: "new-cafe", placeId: "new-cafe", name: "새 카페" } : place) };
    const result = await executeLimitedMutation(input(task([change("keep", 2)]),
      "카페는 그대로 둬", { primary: changed }), foot);
    expect(result.taskResult).toMatchObject({ status: "failed", failureCode: "mutation_verification_failed" });
    if (result.result.status === "plan") expect(result.result.items[2].id).toBe("item-cafe-b");
  });

  it("uses only a deterministic 19:00 time and preserves the other item IDs", async () => {
    expect(deterministicMutationTime("저녁 7시로 미뤄줘", "meal")).toBe("19:00");
    const entry = task([change("retime", 1, { explicitValue: "12:00" })]);
    const result = await executeLimitedMutation(input(entry, "저녁 7시로 미뤄줘"), foot);
    expect(result.taskResult?.status).toBe("success");
    if (result.result.status === "plan") {
      expect(result.result.items[1].startTime).toBe("19:00");
      expect(result.result.items.map(item => item.placeId)).toEqual(ids);
    }
  });

  it("swaps only the two verified ordinal items", async () => {
    const entry = task([change("reorder", 1)], { targets: [itemTarget(1), itemTarget(2)] });
    const result = await executeLimitedMutation(input(entry, "두 번째랑 세 번째 순서 바꿔줘"), foot);
    expect(result.taskResult?.status).toBe("success");
    if (result.result.status === "plan") expect(result.result.items.map(item => item.placeId))
      .toEqual(["cafe-a", "cafe-b", "dinner"]);
  });

  it("rejects a reorder whose claimed target is outside the two verified references", async () => {
    const entry = task([change("reorder", 0)], { targets: [itemTarget(1), itemTarget(2)] });
    const result = await executeLimitedMutation(input(entry, "두 번째랑 세 번째 순서 바꿔줘"), foot);
    expect(result.taskResult).toMatchObject({ status: "skipped", failureCode: "unverified_target" });
    expect(result.result).toBe(chat);
  });

  it("accepts a legacy replacement only when KEEP cafe survives and clears an operational exclusion", async () => {
    const entry = task([change("keep", 2), change("replace", 1, {
      replacementPreference: { dimension: "atmosphere", value: "romantic" } })]);
    const before = basePlan();
    const after: AIPlannerReply = { ...before, message: "새 저녁 코스",
      items: before.items.map(item => item.placeId === "dinner"
        ? { ...item, id: "item-new-dinner", placeId: "new-dinner", placeName: "새 저녁 식당" } : item),
      recommendations: before.recommendations.map(place => place.placeId === "dinner"
        ? { ...place, id: "new-dinner", placeId: "new-dinner", name: "새 저녁 식당" } : place),
      state: { ...baseState, preserveExistingPlaces: true, intent: "modify", excludedPlaces: ["저녁 식당"] } };
    const request = input(entry, "카페는 그대로 두고 저녁은 분위기 좋은 곳으로 바꿔줘", { primary: after });
    const built = buildVerifiedMutationTransaction(request);
    expect(built && "transaction" in built && built.transaction.operations[1].replacementPreference)
      .toEqual({ dimension: "atmosphere", value: "romantic" });
    const result = await executeLimitedMutation(request, foot);
    expect(result.taskResult).toMatchObject({ status: "success", operation: "replace",
      coveredByLegacyRoute: true, preservedItemIds: ["item-cafe-b"] });
    if (result.result.status === "plan") {
      expect(result.result.items[2].id).toBe("item-cafe-b");
      expect(result.result.state.excludedPlaces).not.toContain("저녁 식당");
    }
  });

  it("rejects a replacement outside the verified slot or a changed time window", async () => {
    const before = basePlan();
    const newDinner = { ...before.recommendations[1], id: "new-dinner", placeId: "new-dinner",
      name: "새 저녁 식당" };
    const moved: AIPlannerReply = { ...before,
      items: [before.items[0], before.items[2], { ...before.items[1], id: "new-item",
        placeId: "new-dinner", placeName: "새 저녁 식당" }],
      recommendations: [before.recommendations[0], before.recommendations[2], newDinner] };
    const entry = task([change("replace", 1)]);
    const wrongSlot = await executeLimitedMutation(input(entry, "저녁 바꿔줘", { primary: moved }), foot);
    expect(wrongSlot.taskResult).toMatchObject({ status: "failed", failureCode: "mutation_verification_failed" });
    const validPlace: AIPlannerReply = { ...before,
      items: before.items.map((item, index) => index === 1 ? { ...item, id: "new-item",
        placeId: "new-dinner", placeName: "새 저녁 식당" } : item),
      recommendations: before.recommendations.map((place, index) => index === 1 ? newDinner : place),
      condition: { ...before.condition, endTime: "23:30" } };
    const changedWindow = await executeLimitedMutation(input(entry, "저녁 바꿔줘",
      { primary: validPlace }), foot);
    expect(changedWindow.taskResult).toMatchObject({ status: "failed", failureCode: "mutation_verification_failed" });
  });

  it("rejects a hard budget violation and rolls back to the original course", async () => {
    const before = basePlan();
    const invalid: AIPlannerReply = { ...before,
      items: before.items.filter(item => item.placeId !== "dinner").map(item => ({ ...item, expectedCost: 90000 })),
      recommendations: before.recommendations.filter(place => place.placeId !== "dinner") };
    const result = await executeLimitedMutation(input(task([change("remove", 1)]), "저녁 식당 빼줘",
      { primary: invalid }), foot);
    expect(result.taskResult).toMatchObject({ status: "failed", failureCode: "mutation_verification_failed" });
    expect(result.result.status).toBe("plan");
    if (result.result.status === "plan") expect(result.result.items.map(item => item.placeId)).toEqual(ids);
  });

  it("rejects an impossible route and retains the original course", async () => {
    const impossible = vi.fn(async (coordinates: [number, number][]): Promise<FootRoute> => ({
      legs: Array.from({ length: coordinates.length - 1 }, () => ({ meters: 9000, seconds: 3600 })),
      meters: 9000 * (coordinates.length - 1), seconds: 3600 * (coordinates.length - 1), provider: "osm_foot",
    }));
    const result = await executeLimitedMutation(input(task([change("remove", 1)]), "두 번째 장소 빼줘",
      { primary: basePlan() }), impossible);
    expect(result.taskResult).toMatchObject({ status: "failed", failureCode: "route_failed" });
    if (result.result.status === "plan") expect(result.result.items.map(item => item.placeId)).toEqual(ids);
  });

  it("rejects a target time outside the schedule window", async () => {
    const result = await executeLimitedMutation(input(task([change("retime", 1)]),
      "저녁 22시 30분으로 미뤄줘"), foot);
    expect(result.taskResult).toMatchObject({ status: "failed", failureCode: "schedule_failed" });
    expect(result.result).toBe(chat);
  });

  it("does not start a new search when a legacy replacement is unavailable", async () => {
    foot.mockClear();
    const result = await executeLimitedMutation(input(task([change("replace", 1)]),
      "저녁만 다른 곳으로 바꿔줘"), foot);
    expect(result.taskResult).toMatchObject({ status: "failed", failureCode: "replacement_unavailable" });
    expect(result.result).toBe(chat);
    expect(foot).not.toHaveBeenCalled();
  });

  it("does not apply the same legacy removal twice", async () => {
    const before = basePlan();
    const alreadyRemoved: AIPlannerReply = { ...before,
      items: before.items.filter(item => item.placeId !== "dinner"),
      recommendations: before.recommendations.filter(place => place.placeId !== "dinner") };
    const built = buildVerifiedMutationTransaction(input(task([change("remove", 1)]), "두 번째 장소 빼줘"));
    expect(built && "transaction" in built && mutationCoverage(built.transaction, route, before, alreadyRemoved))
      .toMatchObject({ coveredByLegacyRoute: true, shouldExecuteLimitedMutation: false });
    const result = await executeLimitedMutation(input(task([change("remove", 1)]), "두 번째 장소 빼줘",
      { primary: alreadyRemoved }), foot);
    expect(result.taskResult?.coveredByLegacyRoute).toBe(true);
  });

  it("keeps OFF, SHADOW and execution-shadow on the legacy result", async () => {
    const entry = task([change("remove", 1)]);
    for (const variant of [
      { interpreterMode: "off", executionMode: "limited" },
      { interpreterMode: "shadow", executionMode: "limited" },
      { interpreterMode: "assist", executionMode: "shadow" },
    ] as const) {
      const result = await executeLimitedMutation(input(entry, "두 번째 장소 빼줘", variant), foot);
      expect(result.result).toBe(chat);
      expect(result.taskResult?.status).toBe("skipped");
    }
  });

  it("can append a legacy question answer while a verified removal becomes the plan result", async () => {
    const result = await executeLimitedMutation(input(task([change("remove", 1)]), "두 번째 장소 빼줘. 카페 주차 돼?",
      { route: { mode: "question", confident: true } }), foot);
    expect(result.taskResult?.status).toBe("success");
    if (result.result.status === "plan") expect(result.result.card.lines).toContain("기존 경로 응답");
  });
});

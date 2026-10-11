import { describe, expect, it, vi } from "vitest";
import { isManualPlaceAttemptId, manualPlaceAttempt } from "./manualPlaceAttempt";

const values = { name: "우리 카페", category: "cafe" as const, district: "성수", description: "우리 메모", durationMinutes: 60, expectedCostTwo: null };
const attemptId = "11111111-1111-4111-8111-111111111111";

describe("manual place submission identity", () => {
  it("reuses the submission UUID for unchanged retries after an uncertain result", () => {
    const generate = vi.fn(() => attemptId);
    const first = manualPlaceAttempt(null, values, generate);
    expect(manualPlaceAttempt(first, { ...values }, generate)).toBe(first);
    expect(manualPlaceAttempt(first, { ...values, name: " 우리 카페 " }, generate)).toBe(first);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it.each([{ name: "다른 카페" }, { district: "강남" }, { category: "book" as const }, { description: "다른 메모" }])("uses a new attempt for a different place input: %j", patch => {
    const first = manualPlaceAttempt(null, values, () => attemptId);
    const next = manualPlaceAttempt(first, { ...values, ...patch }, () => "new-attempt");
    expect(next.id).toBe("new-attempt");
    expect(next.key).not.toBe(first.key);
  });

  it("starts a new save after the successful attempt has been cleared", () => {
    expect(manualPlaceAttempt(null, values, () => "next-attempt").id).toBe("next-attempt");
  });

  it("accepts generated UUIDv4 identities and rejects malformed row identities", () => {
    expect(isManualPlaceAttemptId(attemptId)).toBe(true);
    for (const value of [undefined, null, "", "place-id", "11111111-1111-1111-8111-111111111111"]) expect(isManualPlaceAttemptId(value)).toBe(false);
  });
});

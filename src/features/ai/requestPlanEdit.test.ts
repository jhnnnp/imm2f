import { beforeEach, expect, it, vi } from "vitest";
import { proposePlanEdits } from "./actions";
import { requestPlanEdit } from "./requestPlanEdit";
vi.mock("./actions", () => ({ proposePlanEdits: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
const input = { kind: "trip" as const, prompt: "시간 조정", items: [] };
it("returns a recoverable error when the server action transport fails", async () => {
  vi.mocked(proposePlanEdits).mockRejectedValue(new TypeError("Failed to fetch"));
  expect(await requestPlanEdit(input, () => true)).toHaveProperty("error", expect.stringContaining("다시 시도"));
});
it.each([false, true])("ignores a late %s failure or proposal after the mode changed", async fail => {
  let current = true;
  let finish!: () => void;
  vi.mocked(proposePlanEdits).mockImplementation(() => new Promise((resolve, reject) => {
    finish = () => fail ? reject(new Error("network")) : resolve({ changes: [], summary: "이전 일정" });
  }));
  const pending = requestPlanEdit(input, () => current);
  current = false;
  finish();
  expect(await pending).toBeNull();
});
it("preserves the server's validation error", async () => {
  vi.mocked(proposePlanEdits).mockResolvedValue({ error: "수정할 장소가 없어요" });
  expect(await requestPlanEdit(input, () => true)).toEqual({ error: "수정할 장소가 없어요" });
});

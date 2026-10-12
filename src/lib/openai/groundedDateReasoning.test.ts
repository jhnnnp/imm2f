import { beforeEach, describe, expect, it, vi } from "vitest";
import { completeJson } from "./client";
import { isOpenAiConfigured } from "./env";
import { reasonFromDateFacts } from "./groundedDateReasoning";

vi.mock("./client", () => ({ completeJson: vi.fn() }));
vi.mock("./env", () => ({ isOpenAiConfigured: vi.fn(() => true) }));
const input = { purpose: "comparison" as const, message: "둘 중 대화하기 좋은 곳은 어디야?",
  subjects: ["A 카페", "B 카페"], unknowns: ["혼잡도"],
  facts: [{ id: "a-noise", subject: "A 카페", summary: "조용하지 않고 음악 소리가 커요." },
    { id: "b-noise", subject: "B 카페", summary: "대화하기 조용한 실내라고 소개돼 있어요." }] };

beforeEach(() => { vi.clearAllMocks(); vi.mocked(isOpenAiConfigured).mockReturnValue(true); });
describe("grounded date reasoning", () => {
  it("asks the configured model to reason with the original question and keeps the cited fact IDs", async () => {
    vi.mocked(completeJson).mockResolvedValue({ statements: [{ text: "대화가 목적이면 B 카페를 먼저 고려할 수 있어요.",
      factIds: ["a-noise", "b-noise"] }] });
    expect(await reasonFromDateFacts(input)).toEqual({ text: "대화가 목적이면 B 카페를 먼저 고려할 수 있어요.",
      usedFactIds: ["a-noise", "b-noise"] });
    const request = vi.mocked(completeJson).mock.calls[0][0];
    expect(JSON.parse(request.messages[1].content)).toEqual(input);
    expect(request.messages[0].content).toContain("Preserve negations");
    expect(request.jsonSchema?.strict).toBe(true);
    expect(request.timeoutMs).toBe(12000);
  });

  it.each([
    { statements: [{ text: "조용해요.", factIds: ["invented"] }] },
    { statements: [{ text: "조용해요.", factIds: [] }] },
    { statements: [{ text: "예약해 드렸어요.", factIds: ["a-noise"] }] },
    { statements: [{ text: "https://invented.example에서 확인했어요.", factIds: ["a-noise"] }] },
    { statements: "invalid" },
  ])("rejects unsupported references and invalid read-only replies", async response => {
    vi.mocked(completeJson).mockResolvedValue(response);
    expect(await reasonFromDateFacts(input)).toBeNull();
  });

  it("does not make a provider request without credentials or an explicit fact set", async () => {
    vi.mocked(isOpenAiConfigured).mockReturnValue(false);
    expect(await reasonFromDateFacts(input)).toBeNull();
    vi.mocked(isOpenAiConfigured).mockReturnValue(true);
    expect(await reasonFromDateFacts({ ...input, facts: [] })).toBeNull();
    expect(completeJson).not.toHaveBeenCalled();
  });
});

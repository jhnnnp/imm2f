import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyDateBrief, withAreas } from "@/features/ai/dateBrief";

vi.mock("./client", () => ({ completeJson: vi.fn() }));
vi.mock("./env", () => ({ isOpenAiConfigured: vi.fn(() => true) }));
vi.mock("./datePlaybook", async importOriginal => ({ ...await importOriginal<typeof import("./datePlaybook")>(),
  retrieveDatePlaybook: vi.fn() }));

import { completeJson } from "./client";
import { retrieveDatePlaybook } from "./datePlaybook";
import { designDateDiscovery, explicitDiscoveryTransport, requestedActivityOrder } from "./designDateDiscovery";

beforeEach(() => vi.clearAllMocks());

describe("user-authored date sequence", () => {
  it("keeps exact preference queries while bounding discovery generation and eliminating remote playbook work", async () => {
    vi.mocked(completeJson).mockResolvedValueOnce({ themes: ["정원과 파스타"], priorities: ["정원 공간"], queries: [
      { region: "성수", query: "파스타" }, { region: "성수", query: "정원 카페" },
      { region: "다른 지역", query: "임의 카페" }, { region: "성수", query: "갤러리" },
      { region: "성수", query: "독립서점" }, { region: "성수", query: "추가 검색" },
    ] });
    const state = withAreas(emptyDateBrief(), ["성수"]);
    const result = await designDateDiscovery({ message: "성수에서 파스타 먹고 정원 카페 가고 싶어", state, taste: ["한적한 공간"] });
    expect(result.queries).toHaveLength(4);
    expect(result.queries).toEqual(expect.arrayContaining([{ region: "성수", query: "파스타" }, { region: "성수", query: "정원 카페" }]));
    expect(result.queries.every(query => query.region === "성수")).toBe(true);
    expect(completeJson).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 8000,
      maxTokens: 1000, reasoningEffort: "low", retryOnTruncation: false }));
    expect(retrieveDatePlaybook).not.toHaveBeenCalled();
  });

  it("covers every supplied region in a bounded fallback query list", async () => {
    vi.mocked(completeJson).mockResolvedValueOnce(null);
    const state = withAreas(emptyDateBrief(), ["부산", "제주", "군산"]);
    const result = await designDateDiscovery({ message: "세 지역 후보를 보고 싶어", state, taste: [] });
    expect(new Set(result.queries.map(query => query.region))).toEqual(new Set(["부산", "제주", "군산"]));
    expect(result.queries.length).toBeLessThanOrEqual(8);
  });

  it("keeps dinner, cafe and performance in the order the user asked", () => {
    expect(requestedActivityOrder("왕십리에서 저녁 먹고 예쁜 카페와 공연장 데이트", ["meal", "cafe", "performance"]))
      .toEqual(["meal", "cafe", "performance"]);
  });

  it("does not insert an unrequested meal into a movie and cafe sequence", () => {
    expect(requestedActivityOrder("영화 보고 카페에 가고 싶어", ["movie", "cafe"]))
      .toEqual(["movie", "cafe"]);
  });
});

describe("user-authored discovery transport", () => {
  it.each([
    ["부산 2박3일 자차로 갈게", "drive"], ["부산을 렌터카로 다닐게", "drive"],
    ["차로 이동할게", "drive"], ["도보로만 갈게", "walk"], ["걸어서 갈게", "walk"],
    ["대중교통으로 갈게", "transit"], ["지하철을 탈게", "transit"], ["버스 타고 갈게", "transit"],
    ["자차 말고 대중교통으로 갈게", "transit"], ["대중교통 말고 차로 갈게", "drive"],
    ["자차는 없고 도보로만", "walk"], ["원래 자차로 가려 했는데 이번엔 도보로 갈게", "walk"],
  ] as const)("extracts an actual transport choice: %s", (message, expected) => {
    expect(explicitDiscoveryTransport({ message })).toBe(expected);
  });

  it.each(["주차 편한 곳으로", "해안 산책 코스", "지하철역 근처 카페", "자동차박물관 보고 싶어",
    "버스킹 보고 싶어", "도보로 갈 수 있어?", "차로 갈지 대중교통으로 갈지 고민이야"])(
    "does not infer a choice from a venue, practical question, or ambiguous alternatives: %s", message => {
      expect(explicitDiscoveryTransport({ message, previous: "drive" })).toBe("drive");
    });

  it("does not infer a mode merely because the user owns a car", () => {
    expect(explicitDiscoveryTransport({ message: "자동차는 있어", previous: "walk" })).toBe("walk");
    expect(explicitDiscoveryTransport({ message: "자차 있어" })).toBe("transit");
  });

  it("honors a user's latest correction while ignoring assistant-authored transport", () => {
    expect(explicitDiscoveryTransport({ message: "선택한 장소로 일정 짜줘", userRequests: ["자차로 부산 여행"],
      conversation: [{ role: "user", text: "이제 도보로만 갈게" },
        { role: "assistant", text: "자차 코스로 만들까요?" }] })).toBe("walk");
    expect(explicitDiscoveryTransport({ message: "이번에는 대중교통으로 갈게", userRequests: ["도보로 갈게"],
      conversation: [{ role: "user", text: "자차로 갈게" }] })).toBe("transit");
  });

  it("does not keep a previous mode when the user explicitly rejects it", () => {
    expect(explicitDiscoveryTransport({ message: "자차로는 안 갈게", previous: "drive" })).toBe("transit");
    expect(explicitDiscoveryTransport({ message: "도보로 가는 건 싫어. 자차로 갈게", previous: "walk" })).toBe("drive");
  });

  it.each(["drive", "walk", "transit"] as const)("keeps the previous %s mode when no raw choice is supplied", previous => {
    expect(explicitDiscoveryTransport({ message: "카페 후보를 골랐어", previous })).toBe(previous);
  });

  it("preserves the first exploration's original drive condition without a model call", async () => {
    const state = { ...withAreas(emptyDateBrief(), ["부산"]), stayKind: "overnight" as const, nights: 2,
      userRequests: ["부산 2박3일 자차로 갈게"], discovery: undefined };
    const result = await designDateDiscovery({ message: "선택한 장소로 일정 짜줘", state, taste: [], useExistingBrief: true });
    expect(result.transport).toBe("drive");
    expect(completeJson).not.toHaveBeenCalled();
    expect(retrieveDatePlaybook).not.toHaveBeenCalled();
  });

  it("preserves a newer conversation correction to walking in the fast path", async () => {
    const state = { ...withAreas(emptyDateBrief(), ["성수"]), userRequests: ["자차로 이동할게"] };
    const result = await designDateDiscovery({ message: "선택한 장소로 일정 짜줘", state, taste: [], useExistingBrief: true,
      conversation: [{ role: "user", text: "차로는 안 갈게. 도보로만 코스 짜줘" },
        { role: "assistant", text: "자동차 이동 조건을 유지하겠습니다." }] });
    expect(result.transport).toBe("walk");
    expect(completeJson).not.toHaveBeenCalled();
  });

  it("keeps an explicit drive instruction even when the discovery model guesses walking", async () => {
    vi.mocked(retrieveDatePlaybook).mockResolvedValueOnce([]);
    vi.mocked(completeJson).mockResolvedValueOnce({ transport: "walk", themes: ["해안 여행"] });
    const state = { ...withAreas(emptyDateBrief(), ["부산"]), stayKind: "overnight" as const, nights: 2 };
    const result = await designDateDiscovery({ message: "부산 2박3일 자차로 갈게", state, taste: [] });
    expect(result.transport).toBe("drive");
    expect(completeJson).toHaveBeenCalledTimes(1);
  });
});

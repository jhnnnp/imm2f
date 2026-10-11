import { beforeEach, describe, expect, it, vi } from "vitest";
import { completeJson } from "./client";
import { analyzePreferencesWithOpenAi, calculatePreferenceInsight, type PreferencePlaceInput } from "./analyzePreferences";

vi.mock("./client", () => ({ completeJson: vi.fn() }));
vi.mock("./env", () => ({ isOpenAiConfigured: () => true }));

const places: PreferencePlaceInput[] = [
  { name: "저장한 카페", categoryLabel: "카페", district: "서울", durationMinutes: 60,
    userStatus: "want", partnerStatus: "revisit", userRated: true, partnerRated: true },
  { name: "아직 응답 없는 식당", categoryLabel: "식당", district: "서울", durationMinutes: 60,
    userStatus: "want", partnerStatus: "neutral", userRated: true, partnerRated: false },
];

beforeEach(() => { vi.mocked(completeJson).mockReset(); });

describe("preference prose integrity", () => {
  it("uses saved-data prose when the provider returns objects or numbers in display fields", async () => {
    vi.mocked(completeJson).mockResolvedValue({ summary: { text: "잘못된 요약" },
      differences: [{ you: {}, partner: 7, bridge: ["잘못된 문장"] }],
      recommendations: [{ title: 12, description: {}, reason: true }] });
    const result = await analyzePreferencesWithOpenAi({ places, youName: "나", partnerName: "파트너" });
    expect(result).toEqual(calculatePreferenceInsight(places));
    expect(JSON.stringify(result)).not.toContain("[object Object]");
  });

  it("keeps valid prose rows and drops malformed rows without changing verified scores", async () => {
    vi.mocked(completeJson).mockResolvedValue({ summary: "  함께 표시한 카페 취향이 있어요.  ",
      matchScore: 0, confidence: 100, commonTastes: [{ label: "모델이 만든 취향", score: 100 }],
      differences: [null, ["배열"], { you: "카페를 좋아해요", partner: "카페에 다시 가고 싶어요", bridge: "함께 고른 곳을 확인해요" },
        { you: "다른 문장", partner: {}, bridge: "거짓 행" }],
      recommendations: [{ title: "함께 고른 조건", description: "카페를 중심에 두어요", reason: "공통 긍정 표시가 있어요" },
        { title: "무효 행", description: true, reason: "거짓 행" }] });
    const result = await analyzePreferencesWithOpenAi({ places, youName: "나", partnerName: "파트너" });
    const fallback = calculatePreferenceInsight(places);
    expect(result).toMatchObject({ summary: "함께 표시한 카페 취향이 있어요.",
      matchScore: fallback.matchScore, confidence: fallback.confidence,
      commonTastes: fallback.commonTastes, evidence: fallback.evidence,
      differences: [{ you: "카페를 좋아해요", partner: "카페에 다시 가고 싶어요", bridge: "함께 고른 곳을 확인해요" }],
      recommendations: [{ title: "함께 고른 조건", description: "카페를 중심에 두어요", reason: "공통 긍정 표시가 있어요" }] });
  });

  it("fails softly when the provider is unavailable", async () => {
    vi.mocked(completeJson).mockRejectedValue(new Error("mock transport failure"));
    expect(await analyzePreferencesWithOpenAi({ places, youName: "나", partnerName: "파트너" }))
      .toEqual(calculatePreferenceInsight(places));
  });

  it("avoids a paid generation for an empty saved-place set", async () => {
    expect(await analyzePreferencesWithOpenAi({ places: [], youName: "나", partnerName: "파트너" }))
      .toMatchObject({ error: expect.any(String) });
    expect(completeJson).not.toHaveBeenCalled();
  });
});

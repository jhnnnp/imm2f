import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscoverCandidate } from "@/features/places/types/place";
import { completeJson, completeJsonWithWebSearch } from "./client";
import { recommendPlacesWithOpenAi } from "./recommendPlaces";
import { after } from "next/server";

vi.mock("./client", () => ({ completeJson: vi.fn(), completeJsonWithWebSearch: vi.fn() }));
vi.mock("./env", () => ({ isOpenAiConfigured: () => true }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/places/detailCache", () => ({ writePlaceDetailCache: vi.fn() }));

function cafe(id: string): DiscoverCandidate {
  return { externalSource: "kakao", externalPlaceId: id, name: `카페 ${id}`, category: "cafe", categoryLabel: "카페",
    district: "성수", address: "성수로 1", roadAddress: "", phone: "", mapUrl: "https://place.map.kakao.com/1",
    coordinates: [127.04, 37.56], evidence: [{ id: `garden-${id}`, venueId: `kakao:${id}`,
      text: "정원과 테라스 좌석이 있습니다.", url: `https://example.com/${id}`, checkedAt: "2026-10-12", verification: "source_checked" }] };
}
const input = () => ({ message: "성수에서 둘이 대화하면서 쉬어갈 카페 딱 한 곳 추천해줘", ask: { kind: "cafe" as const, area: "성수", query: "카페" },
  candidates: [cafe("a"), cafe("b"), cafe("c")], savedNames: new Set<string>(), bothWant: new Set<string>(),
  coupleTaste: { summary: "", commonTastes: [], avoidFoods: [] }, alreadyShown: [], skipFactLookup: true });

beforeEach(() => { vi.mocked(completeJson).mockReset(); vi.mocked(completeJsonWithWebSearch).mockReset(); vi.mocked(after).mockReset(); });
afterEach(() => vi.restoreAllMocks());

describe("AI place curation", () => {
  it("shows AI's specific judgment and intro, accepting one strong match without padding three places", async () => {
    const intro = "오래 앉아 대화하고 싶다는 말씀에 맞춰 쉬어가는 시간을 중심으로 골랐어요.";
    const why = "자료에 소개된 테라스 좌석이 있어서 바깥에서 쉬는 경험을 담으려고 골랐어요.";
    vi.mocked(completeJson).mockResolvedValueOnce({ intro, picks: [{ id: "kakao:b", why, evidenceIds: ["observation:garden-b"] }] });
    const result = await recommendPlacesWithOpenAi(input());
    expect(result.source).toBe("openai");
    expect(result.shownPlaces).toEqual(["카페 b"]);
    expect(result.card.lines).toEqual([intro]);
    expect(result.card.stops?.[0].reason).toBe(why);
    const call = vi.mocked(completeJson).mock.calls[0][0];
    expect(call.jsonSchema).toMatchObject({ name: "grounded_place_recommendations", strict: true });
    expect(JSON.parse(call.messages[1].content).candidates[1].recommendationEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "observation:garden-b", text: "정원과 테라스 좌석이 있습니다." }),
    ]));
    expect(completeJsonWithWebSearch).not.toHaveBeenCalled();
  });

  it("retains a valid AI selection but replaces unsupported venue claims with known facts", async () => {
    vi.mocked(completeJson).mockResolvedValueOnce({ intro: "한 곳에서 충분히 쉬어갈 수 있는 흐름으로 골랐어요.",
      picks: [{ id: "kakao:a", why: "조용하고 예약 없이 바로 들어갈 수 있어요.", evidenceIds: ["provider:category"] }] });
    const result = await recommendPlacesWithOpenAi(input());
    expect(result.source).toBe("openai");
    expect(result.shownPlaces).toEqual(["카페 a"]);
    expect(result.card.stops?.[0].reason).not.toMatch(/조용|예약\s*없이/);
  });

  it("reports model failure instead of presenting heuristic picks as AI judgment", async () => {
    vi.mocked(completeJson).mockResolvedValueOnce(null);
    const result = await recommendPlacesWithOpenAi(input());
    expect(result.source).toBe("fallback");
    expect(result.card.lines[0]).toContain("AI 추천 응답을 받지 못해");
  });

  it("does not accept an invented venue identity", async () => {
    vi.mocked(completeJson).mockResolvedValueOnce({ intro: "취향을 생각해서 편하게 머물 곳을 골랐어요.",
      picks: [{ id: "kakao:invented", why: "편하게 쉬기 좋은 곳이에요.", evidenceIds: ["provider:category"] }] });
    const result = await recommendPlacesWithOpenAi(input());
    expect(result.source).toBe("fallback");
    expect(result.shownPlaces).not.toContain("invented");
  });

  it("keeps successful recommendations when optional cache scheduling has no Next request lifecycle", async () => {
    vi.mocked(after).mockImplementationOnce(() => { throw new Error("no request context"); });
    vi.mocked(completeJsonWithWebSearch).mockImplementationOnce(async request => {
      request.onSources?.(["https://example.com/menu"]);
      return { id: "kakao:a", sourceVenueName: "카페 a", sourceAddress: "성수로 1",
        food: "수제 티라미수", sourceExcerpt: "카페 a 성수로 1 수제 티라미수를 판매합니다.", sourceUrl: "https://example.com/menu" };
    });
    vi.mocked(completeJson).mockResolvedValueOnce({ intro: "가볍게 디저트를 곁들이면서 쉬어갈 곳을 골랐어요.",
      picks: [{ id: "kakao:a", why: "자료에 소개된 수제 티라미수를 곁들이며 쉬어갈 수 있게 골랐어요.", evidenceIds: ["public:menu"] }] });
    const result = await recommendPlacesWithOpenAi({ ...input(), candidates: [cafe("a")], skipFactLookup: false });
    expect(after).toHaveBeenCalledOnce();
    expect(result.source).toBe("openai");
    expect(result.card.stops?.[0].dishes).toBe("수제 티라미수");
  });
});

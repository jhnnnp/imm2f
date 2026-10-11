import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyDateBrief } from "@/features/ai/dateBrief";
import type { DiscoverCandidate } from "@/features/places/types/place";
import type { ResearchNeed } from "@/features/ai/researchPlan";

vi.mock("./env", () => ({ isOpenAiConfigured: vi.fn(() => true) }));
vi.mock("./client", () => ({ completeJsonWithWebSearch: vi.fn() }));
vi.mock("./venueEvidenceStore", () => ({ readVenueEvidence: vi.fn(), writeVenueEvidence: vi.fn() }));

import { completeJsonWithWebSearch } from "./client";
import { readVenueEvidence, writeVenueEvidence } from "./venueEvidenceStore";
import { enrichResearchNeedEvidence } from "./enrichDateVenues";

const venue: DiscoverCandidate = { externalSource: "kakao", externalPlaceId: "taejongdae",
  name: "태종대 전망대", category: "tourist", categoryLabel: "관광명소", district: "부산 영도구",
  address: "부산 영도구 동삼동 산 29-1", roadAddress: "", phone: "", mapUrl: "",
  coordinates: [129.08, 35.05] };
const need: ResearchNeed = { id: "explore-nightview", kind: "venue", purpose: "야경 전망대 방문 경험",
  category: "tourist", geographicFocus: "부산", qualities: [], evidenceNeeded: [], priority: "required" };
const url = "https://example.com/taejongdae";
const observation = { text: "전망 공간에서 해안 절벽의 풍경을 볼 수 있습니다.", sourceUrl: url,
  sourceVenueName: venue.name, sourceAddress: "부산광역시 영도구 동삼동 산29-1",
  sourceExcerpt: "전망 공간에서 해안 절벽의 풍경을 볼 수 있습니다." };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readVenueEvidence).mockResolvedValue(new Map());
  vi.mocked(completeJsonWithWebSearch).mockImplementation(async options => {
    options.onSources?.([url]);
    return { venues: [{ id: "kakao:taejongdae", observations: [observation] }] } as never;
  });
});

describe("exploration evidence handoff", () => {
  it("uses cited exact-branch research for a plain night-view request without optional filters", async () => {
    const result = await enrichResearchNeedEvidence([venue], emptyDateBrief(), [need], 2);
    expect(completeJsonWithWebSearch).toHaveBeenCalledOnce();
    expect(completeJsonWithWebSearch).toHaveBeenCalledWith(expect.objectContaining({
      requireSearch: true, timeoutMs: 9000, payload: expect.objectContaining({ venues: [
        expect.objectContaining({ id: "kakao:taejongdae", researchFocus: expect.stringContaining("experience") }),
      ] }),
    }));
    expect(result[0].evidence).toContainEqual(expect.objectContaining({ text: observation.text,
      venueId: "kakao:taejongdae", verification: "search_report" }));
    expect(writeVenueEvidence).toHaveBeenCalledOnce();
  });

  it("does not spend another search on a fresh previously checked description", async () => {
    const cached = { id: "cached", venueId: "kakao:taejongdae", text: observation.text, url,
      checkedAt: new Date().toISOString(), verification: "source_checked" as const, attribute: "experience" as const };
    vi.mocked(readVenueEvidence).mockResolvedValue(new Map([["kakao:taejongdae", [cached]]]));
    const result = await enrichResearchNeedEvidence([venue], emptyDateBrief(), [need], 2);
    expect(result[0].evidence).toContainEqual(cached);
    expect(completeJsonWithWebSearch).not.toHaveBeenCalled();
  });

  it("keeps a description unknown when the provider returns another lot", async () => {
    vi.mocked(completeJsonWithWebSearch).mockImplementation(async options => {
      options.onSources?.([url]);
      return { venues: [{ id: "kakao:taejongdae", observations: [{ ...observation,
        sourceAddress: "부산광역시 영도구 동삼동 산29-10" }] }] } as never;
    });
    const result = await enrichResearchNeedEvidence([venue], emptyDateBrief(), [need], 2);
    expect(result[0].evidence?.length ?? 0).toBe(0);
  });

  it("keeps quality and basic description requests in the same per-group research budget", async () => {
    const candidates = Array.from({ length: 15 }, (_, index) => ({ ...venue,
      externalPlaceId: String(index), name: `전망대 ${index}` }));
    await enrichResearchNeedEvidence(candidates, emptyDateBrief(), [need, { ...need,
      id: `${need.id}-evidence`, kind: "evidence", qualities: ["view"], evidenceNeeded: ["view"] }], 2);
    const requested = vi.mocked(completeJsonWithWebSearch).mock.calls.flatMap(([options]) =>
      (options.payload as { venues: unknown[] }).venues);
    expect(requested).toHaveLength(2);
  });
});

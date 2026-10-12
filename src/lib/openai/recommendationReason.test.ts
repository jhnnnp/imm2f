import { describe, expect, it } from "vitest";
import type { DiscoverCandidate } from "@/features/places/types/place";
import { groundedRecommendationReason, recommendationEvidence, recommendationIntro } from "./recommendationReason";

const venue: DiscoverCandidate = { externalSource: "kakao", externalPlaceId: "a", name: "정원 카페", category: "cafe",
  categoryLabel: "카페", district: "성수", address: "성수로 1", roadAddress: "", phone: "", mapUrl: "",
  coordinates: [127.04, 37.54], evidence: [
    { id: "garden", venueId: "kakao:a", text: "정원과 테라스 좌석이 있습니다.", url: "https://example.com/a", checkedAt: "2026-10-12", verification: "search_report" },
    { id: "other", venueId: "kakao:b", text: "루프탑 좌석이 있습니다.", url: "https://example.com/b", checkedAt: "2026-10-12" },
  ] };

describe("grounded recommendation explanations", () => {
  it("lets the model explain an experience from provider category without claiming a researched quality", () => {
    const text = "둘이 앉아 대화하며 쉬어가는 시간을 담으려고 카페를 골랐어요.";
    expect(groundedRecommendationReason(text, ["provider:category"], recommendationEvidence(venue))).toBe(text);
  });

  it("attributes searched facts and never allows evidence from another provider identity", () => {
    const facts = recommendationEvidence(venue);
    expect(facts.map(fact => fact.id)).not.toContain("observation:other");
    const text = "테라스에서 쉬는 경험을 원하셔서 이곳을 골랐어요.";
    expect(groundedRecommendationReason(text, ["observation:garden"], facts)).toContain("온라인 자료를 보면");
    expect(groundedRecommendationReason("루프탑에서 둘이 쉬기 좋아요.", ["observation:other"], facts)).toBe("");
    expect(groundedRecommendationReason(text, ["observation:garden", "invented"], facts)).toBe("");
  });

  it("rejects unsupported crowds, numeric ratings and guaranteed allergy safety", () => {
    const facts = recommendationEvidence(venue);
    expect(groundedRecommendationReason("조용하고 한적해서 대화하기 좋은 곳이에요.", ["provider:category"], facts)).toBe("");
    expect(groundedRecommendationReason("평점 4.9점이라 맛있는 커피를 기대할 수 있어요.", ["provider:category"], facts)).toBe("");
    expect(groundedRecommendationReason("알레르기가 있어도 안전하게 먹을 수 있어요.", ["provider:category"], facts)).toBe("");
    expect(groundedRecommendationReason("100명의 후기가 있어요.", ["observation:garden"], facts)).toBe("");
  });

  it("preserves provider names containing numbers without treating those numbers as ratings or counts", () => {
    const facts = recommendationEvidence({ ...venue, name: "빌라1990", evidence: [] });
    const text = "빌라 1990은 카페로 확인되어 두 분이 앉아 대화할 후보로 골랐어요.";
    expect(facts).toContainEqual({ id: "provider:identity", text: "빌라1990", verification: "provider" });
    expect(groundedRecommendationReason(text, ["provider:category"], facts)).toBe(text);
    expect(groundedRecommendationReason("빌라1990에는 후기 1990개가 있어요.", ["provider:identity"], facts)).toBe("");
    expect(groundedRecommendationReason("빌라1990에는 후기 19개가 있어요.", ["provider:identity"], facts)).toBe("");
    const comparison = "카페1964는 대화할 카페 후보예요. 혼잡도와 좌석은 아직 모르므로, 빌라1990보다 덜 붐비거나 대화하기 편하다고 판단할 근거는 없어요.";
    const comparisonFacts = recommendationEvidence({ ...venue, name: "카페1964", evidence: [] });
    expect(groundedRecommendationReason(comparison, ["provider:category"], comparisonFacts, 180, ["빌라1990", "카페1964"])).toBe(comparison);
    const uncertainty = "카페1964 역시 성수에서 카페를 찾는 조건에 맞는 대안이에요. 혼잡도와 좌석은 아직 모르므로, 조용히 오래 대화하기 좋은 곳이라고 단정하거나 빌라1990보다 낫다고 비교하기는 어려워요.";
    expect(groundedRecommendationReason(uncertainty, ["provider:category"], comparisonFacts, 180, ["빌라1990", "카페1964"])).toBe(uncertainty);
    expect(groundedRecommendationReason("카페1964는 빌라1990보다 조용해서 대화하기 좋아요.",
      ["provider:category"], comparisonFacts, 180, ["빌라1990", "카페1964"])).toBe("");
  });

  it("keeps attribute uncertainty and pre-visit checking caveats with contextual reasoning", () => {
    const facts = recommendationEvidence({ ...venue, name: "빌라1990", evidence: [] });
    for (const text of [
      "둘이 앉아 쉬어갈 후보로 골랐어요. 혼잡도와 좌석은 아직 확인되지 않았어요.",
      "대화할 카페 후보로 골랐지만 조용한지는 확인하지 못했어요.",
      "카페에서 쉬어가는 흐름을 생각했어요. 붐비는지는 방문 전에 확인해 주세요.",
      "예약 가능 여부는 확인이 필요하지만 카페에서 대화하며 쉬어갈 후보예요.",
      "카페에서 쉬어갈 후보예요. 테라스 여부는 아직 알 수 없어요.",
    ]) expect(groundedRecommendationReason(text, ["provider:category"], facts)).toBe(text);
  });

  it("does not let another attribute's caveat conceal an unsupported affirmative claim", () => {
    const facts = recommendationEvidence({ ...venue, name: "빌라1990", evidence: [] });
    for (const text of [
      "조용하고 한적해서 대화하기 좋지만 혼잡도는 확인되지 않았어요.",
      "혼잡도는 확인하지 못했지만 조용한 카페예요.",
      "예약은 가능하고 혼잡도는 아직 알 수 없어요.",
      "테라스가 있어서 쉬기 좋아요. 예약 여부는 확인이 필요해요.",
      "혼잡도는 알 수 없지만 평점 4.9점이라 좋아요.",
    ]) expect(groundedRecommendationReason(text, ["provider:category"], facts)).toBe("");
  });

  it("requires mood claims to match the cited attribute's polarity", () => {
    const fact = (text: string) => [{ id: "mood", text, verification: "source_checked" as const }];
    expect(groundedRecommendationReason("조용한 카페여서 대화할 후보로 골랐어요.", ["mood"], fact("조용하지 않은 공간입니다."))).toBe("");
    expect(groundedRecommendationReason("조용하지 않은 공간이라 활기 있는 경험을 생각했어요.", ["mood"], fact("조용한 독립 좌석이 있습니다."))).toBe("");
    expect(groundedRecommendationReason("시끄럽게 음악을 듣는 경험을 생각했어요.", ["mood"], fact("시끄럽지 않은 공간입니다."))).toBe("");
    expect(groundedRecommendationReason("혼잡한 공간이어서 활기를 느끼는 경험으로 골랐어요.", ["mood"], fact("혼잡한 공간이 아닙니다."))).toBe("");
    const text = "조용하지 않은 공간이라 활기 있는 경험을 생각했어요.";
    expect(groundedRecommendationReason(text, ["mood"], fact("조용하지 않은 공간입니다."))).toBe(text);
    const caveat = "카페에서 쉬어갈 후보로 골랐어요. 조용한지는 아직 확인되지 않았어요.";
    expect(groundedRecommendationReason(caveat, ["mood"], fact("조용한 공간인지 아직 확인되지 않았습니다."))).toBe(caveat);
  });

  it("excludes malformed and credential-bearing source URLs from every evidence channel", () => {
    const unsafe = "https://official.example.com@attacker.example.com/facts";
    const facts = recommendationEvidence({ ...venue, factSourceUrl: unsafe, dishes: "수제 티라미수", rating: 4.5,
      evidence: [{ ...venue.evidence![0], url: "https://name:password@example.com/facts" },
        { ...venue.evidence![0], id: "malformed", url: "https://" }],
      performanceEvent: { id: "event", title: "공연", dateYmd: "20261012", showtimes: ["19:00"], genre: "연극",
        sourceUrl: unsafe, checkedAt: "2026-10-12" } });
    expect(facts.every(fact => !fact.url)).toBe(true);
    expect(facts.map(fact => fact.id)).not.toEqual(expect.arrayContaining(["public:menu", "public:rating", "public:performance"]));
    expect(groundedRecommendationReason("티라미수와 쉬어가는 경험을 골랐어요.", ["public:menu"], facts)).toBe("");
  });

  it("allows a relevant named intro and rejects fabricated operational claims and counts", () => {
    const intro = "정원 카페를 중심으로 잠깐 앉아 대화할 수 있는 흐름을 생각했어요.";
    expect(recommendationIntro(intro, [venue])).toBe(intro);
    expect(recommendationIntro("예약 없이도 무조건 들어갈 수 있는 곳이에요.", [venue])).toBe("");
    expect(recommendationIntro("조건에 맞는 5곳을 찾아서 골랐어요.", [venue])).toBe("");
  });

  it("preserves operational uncertainty in a course strategy intro without accepting affirmative operational claims", () => {
    for (const intro of [
      "대화할 시간을 넉넉히 두고 식사와 휴식을 이었어요. 영업시간과 예약 여부는 방문 전에 확인해 주세요.",
      "걷는 사이에 쉬는 흐름으로 골랐어요. 영업시간과 휴무 여부는 아직 확인되지 않았어요.",
      "머무는 시간을 넉넉히 두었어요. 예약이 필요한지는 방문 전에 확인해야 해요.",
    ]) expect(recommendationIntro(intro, [venue])).toBe(intro);
    for (const intro of [
      "예약 가능한 곳을 골라서 대화하기 편해요. 영업시간은 확인이 필요해요.",
      "예약은 필수지만 영업시간은 확인이 필요해요.",
      "무료라서 쉬기 편하고 영업시간은 확인이 필요해요.",
      "주차 가능한 카페에서 쉬는 흐름으로 골랐어요.",
    ]) expect(recommendationIntro(intro, [venue])).toBe("");
  });
});

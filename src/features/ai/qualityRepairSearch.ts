import type { DateQualityAssessment, DateQualityRequirement } from "./dateQualityCritic";
import type { AIPlannerState } from "@/features/planning/types/plan";
import type { PlaceCategoryId } from "@/features/places/types/place";

function phrases(requirement: DateQualityRequirement, state: AIPlannerState) {
  const cafe = requirement.category === "cafe" || requirement.category === "any" && state.activities.includes("cafe");
  const category: PlaceCategoryId | undefined = cafe ? "cafe" : requirement.category === "meal" ? "restaurant" : undefined;
  if (requirement.dimension === "menu") {
    const menus = [...new Set((requirement.value?.split("|") ?? []).map(value => value.trim()).filter(Boolean))];
    return { category: category ?? "restaurant", terms: [...menus, `${menus[0] ?? "대표 메뉴"} 전문점`] };
  }
  const terms: Record<string, string[]> = {
    quiet: cafe ? ["조용한 카페", "티룸", "북카페"] : category === "restaurant"
      ? ["조용한 레스토랑", "룸 식당"] : ["조용한 카페", "티룸"],
    scenic: cafe ? ["전망 카페", "뷰 카페"] : ["전망대", "풍경 명소"],
    view: ["전망 카페", "뷰 카페"], aesthetic: ["정원 카페", "건축 카페", "갤러리 카페"],
    atmosphere: cafe ? ["정원 카페", "티룸"] : ["분위기 레스토랑", "정원 식당"],
    romantic: ["테라스 레스토랑", "야경 카페"], spacious: ["대형 카페", "넓은 카페"],
    hanok: ["한옥 카페", "전통 찻집"], traditional: ["전통 찻집", "한옥 카페"],
  };
  return { category, terms: terms[requirement.dimension] ?? [] };
}

/** Search for the unsatisfied condition, not another arbitrary venue category.
 * These phrases discover candidates; only branch evidence can satisfy a quality. */
export function qualityRepairSearches(assessment: DateQualityAssessment, state: AIPlannerState,
  regions: string[], attempted: ReadonlySet<string>, limit = 3) {
  const calls: Array<{ tool: "search_places"; region: string; query: string; category?: PlaceCategoryId }> = [];
  const budget = limit <= 0 ? 0 : Number.isFinite(limit) ? Math.min(3, Math.floor(limit)) : 3;
  if (budget < 1) return calls;
  const destinations = [...new Set(regions.map(region => region.trim()).filter(Boolean))].slice(0, 2);
  const seen = new Set<string>();
  for (const requirement of assessment.requirements.filter(item => item.origin === "explicit_constraint" && item.status !== "supported")) {
    const { category, terms } = phrases(requirement, state);
    for (const region of destinations) {
      const query = terms.find(term => !attempted.has(`${region}:${term}`) && !seen.has(`${region}:${term}`));
      if (!query) continue;
      seen.add(`${region}:${query}`);
      calls.push({ tool: "search_places", region, query, category });
      if (calls.length >= budget) return calls;
    }
  }
  return calls;
}

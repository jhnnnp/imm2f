import type { PlanItem } from "@/features/planning/types/plan";
import type { BudgetBreakdown, BudgetBucketId } from "./types";

const BUCKETS: Array<{ id: BudgetBucketId; label: string; match: RegExp }> = [
  { id: "food", label: "식비", match: /restaurant|food|dinner|lunch|한식|맛집|식사/i },
  { id: "cafe", label: "카페", match: /cafe|bakery|book|커피|베이커리|카페|책방/i },
  { id: "transport", label: "교통", match: /transport|train|bus|taxi|교통|이동/i },
  { id: "stay", label: "숙박", match: /stay|hotel|숙박|호텔|펜션/i },
  { id: "tour", label: "관광", match: /tourist|nature|photo|festival|관광|자연|사진|축제|산책/i },
  { id: "shop", label: "쇼핑", match: /shop|shopping|쇼핑/i },
];

function bucketFor(category: string): BudgetBucketId {
  const hit = BUCKETS.find(item => item.match.test(category));
  return hit?.id ?? "other";
}

export function buildBudgetBreakdown(items: PlanItem[]): {
  expected: number;
  buckets: BudgetBreakdown[];
} {
  const totals = new Map<BudgetBucketId, number>();
  items.forEach(item => {
    const id = bucketFor(item.category);
    totals.set(id, (totals.get(id) ?? 0) + (item.expectedCost || 0));
  });

  const labels: Record<BudgetBucketId, string> = {
    food: "식비",
    cafe: "카페",
    transport: "교통",
    stay: "숙박",
    tour: "관광",
    shop: "쇼핑",
    other: "기타",
  };

  const buckets = ([...totals.entries()] as Array<[BudgetBucketId, number]>)
    .filter(([, amount]) => amount > 0)
    .map(([id, amount]) => ({ id, label: labels[id], amount }))
    .sort((a, b) => b.amount - a.amount);

  return {
    expected: items.reduce((sum, item) => sum + (item.expectedCost || 0), 0),
    buckets,
  };
}

import { buildBudgetBreakdown } from "../budget";
import type { PlanItem } from "@/features/planning/types/plan";

function formatWon(value: number) {
  return Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function BudgetPanel({
  items,
  totalBudget = 0,
}: {
  items: PlanItem[];
  totalBudget?: number;
}) {
  const { expected, buckets } = buildBudgetBreakdown(items);
  const budget = totalBudget > 0 ? totalBudget : Math.max(expected, 0);
  const remaining = budget - expected;

  return (
    <section className="budget-panel" aria-label="예산">
      <div className="budget-summary">
        <div>
          <span>총 예산</span>
          <b>₩{formatWon(budget)}</b>
        </div>
        <div>
          <span>예상 사용</span>
          <b>₩{formatWon(expected)}</b>
        </div>
        <div>
          <span>남은 예산</span>
          <b className={remaining < 0 ? "is-over" : ""}>₩{formatWon(remaining)}</b>
        </div>
      </div>
      <div className="budget-breakdown">
        {buckets.length === 0 && <p className="form-hint">일정이 생기면 카테고리별 예산이 보여요.</p>}
        {buckets.map(item => (
          <div className="budget-row" key={item.id}>
            <span>{item.label}</span>
            <b>₩{formatWon(item.amount)}</b>
            <i style={{ width: `${Math.max(8, (item.amount / Math.max(expected, 1)) * 100)}%` }} />
          </div>
        ))}
      </div>
    </section>
  );
}

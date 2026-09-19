import type { PlanItem } from "./types/plan";

export function itemsForDay(items: PlanItem[], day: number) {
  return items.filter(item => (item.dayIndex ?? 0) === day).sort((a, b) => a.order - b.order);
}

export function replacePlanDay(all: PlanItem[], day: number, next: PlanItem[]) {
  const others = all.filter(item => (item.dayIndex ?? 0) !== day);
  return [...others, ...next.map((item, order) => ({ ...item, dayIndex: day, order }))]
    .sort((a, b) => a.dayIndex - b.dayIndex || a.order - b.order)
    .map((item, order) => ({ ...item, order }));
}

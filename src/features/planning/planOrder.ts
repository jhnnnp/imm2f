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

/** Move one stop onto another day, appending it at the end of that day. */
export function movePlanItemToDay(all: PlanItem[], itemId: string, targetDay: number) {
  const item = all.find(entry => entry.id === itemId);
  if (!item) return all;
  const fromDay = item.dayIndex ?? 0;
  if (fromDay === targetDay) return all;

  const sourceDay = itemsForDay(all, fromDay).filter(entry => entry.id !== itemId);
  const afterSource = replacePlanDay(all, fromDay, sourceDay);
  const destination = [...itemsForDay(afterSource, targetDay), { ...item, dayIndex: targetDay }];
  return replacePlanDay(afterSource, targetDay, destination);
}

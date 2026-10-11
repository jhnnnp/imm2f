import type { PlanItem, PlanKind } from "./types/plan";

/** A revisit on another travel day is a separate stop, with its own time and ID. */
export function appendPlanItem(items: PlanItem[], item: PlanItem, kind: PlanKind): { duplicate: boolean; items: PlanItem[]; error?: string } {
  const day = kind === "date" ? 0 : item.dayIndex;
  const dayItems = items.filter(existing => (existing.dayIndex ?? 0) === day);
  if (dayItems.some(existing => existing.placeId === item.placeId)) {
    return { duplicate: true, items };
  }

  const last = [...dayItems].sort((a, b) => a.order - b.order).at(-1);
  let startTime = item.startTime;
  if (last) {
    const [hours, minutes] = last.startTime.split(":").map(Number);
    const total = hours * 60 + minutes + last.durationMinutes + 20;
    if (total >= 24 * 60) return { duplicate: false, items, error: "이 날짜의 마지막 일정이 자정을 넘어요. 시간을 조정하거나 다음 날짜에 장소를 담아 주세요." };
    startTime = `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  }
  const ids = new Set(items.map(existing => existing.id));
  let id = item.id;
  for (let suffix = 1; ids.has(id); suffix += 1) id = `${item.id}-day-${day}-${suffix}`;
  return { duplicate: false, items: [...items, { ...item, id, startTime, dayIndex: day, order: items.length }] };
}

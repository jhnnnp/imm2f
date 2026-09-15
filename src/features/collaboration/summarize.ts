import type { PlanItem } from "@/features/planning/types/plan";

export function summarizePlanChange(before: PlanItem[], after: PlanItem[]) {
  const beforeIds = new Set(before.map(item => item.id));
  const afterIds = new Set(after.map(item => item.id));
  const added = after.filter(item => !beforeIds.has(item.id)).map(item => item.placeName);
  const removed = before.filter(item => !afterIds.has(item.id)).map(item => item.placeName);
  const moved = after.filter(item => {
    const prev = before.find(row => row.id === item.id);
    return prev && prev.order !== item.order;
  }).map(item => item.placeName);
  const timed = after.filter(item => {
    const prev = before.find(row => row.id === item.id);
    return prev && (prev.startTime !== item.startTime || prev.durationMinutes !== item.durationMinutes);
  }).map(item => item.placeName);

  const lines: string[] = [];
  if (!before.length && after.length) lines.push(`${after.length}곳 일정 시작`);
  if (added.length) lines.push(`추가: ${added.slice(0, 3).join(", ")}`);
  if (removed.length) lines.push(`삭제: ${removed.slice(0, 3).join(", ")}`);
  if (moved.length) lines.push(`순서 변경: ${moved.slice(0, 3).join(", ")}`);
  if (timed.length) lines.push(`시간 변경: ${timed.slice(0, 3).join(", ")}`);
  if (!lines.length) lines.push(`${after.length}곳 일정 저장`);
  return lines.join(" · ");
}

import type { PlanItem } from "@/features/planning/types/plan";

export const DEFAULT_DATE_TITLE = "우리가 고른 데이트";

export type DateDaySnapshot = {
  date: string;
  title: string;
  notes: string;
  items: PlanItem[];
};

export function hasDateContent(day: Pick<DateDaySnapshot, "title" | "notes" | "items">) {
  return day.items.length > 0 || Boolean(day.notes.trim()) || Boolean(day.title.trim() && day.title.trim() !== DEFAULT_DATE_TITLE);
}

export function emptyDateDay(date = ""): DateDaySnapshot {
  return { date, title: DEFAULT_DATE_TITLE, notes: "", items: [] };
}

export function sortDateDays(days: DateDaySnapshot[]) {
  return [...days].sort((left, right) => left.date.localeCompare(right.date));
}

export function upsertDateDay(days: DateDaySnapshot[], next: DateDaySnapshot) {
  if (!next.date) return days.filter(day => day.date !== next.date);
  if (!hasDateContent(next)) return days.filter(day => day.date !== next.date);
  return sortDateDays([...days.filter(day => day.date !== next.date), next]);
}

export function applyDateSwitch(input: {
  current: DateDaySnapshot;
  drafts: DateDaySnapshot[];
  nextDate: string;
}) {
  const currentDate = input.current.date;
  const nextDate = input.nextDate;
  if (currentDate === nextDate) {
    return { drafts: input.drafts, focus: input.current, mode: "noop" as const };
  }

  if (!currentDate && hasDateContent(input.current) && nextDate) {
    const focus = { ...input.current, date: nextDate };
    return { drafts: upsertDateDay(input.drafts, focus), focus, mode: "assign" as const };
  }

  let drafts = input.drafts;
  if (currentDate) {
    drafts = hasDateContent(input.current)
      ? upsertDateDay(drafts, { ...input.current, date: currentDate })
      : drafts.filter(day => day.date !== currentDate);
  }

  if (!nextDate) {
    return { drafts, focus: { ...input.current, date: "" }, mode: "unschedule" as const };
  }

  const existing = drafts.find(day => day.date === nextDate);
  return {
    drafts,
    focus: existing ? { ...existing } : emptyDateDay(nextDate),
    mode: "switch" as const,
  };
}

export function nextUpcomingDate(days: DateDaySnapshot[], today: string, fallback: DateDaySnapshot) {
  const withContent = sortDateDays(days.filter(day => day.date && hasDateContent(day)));
  const upcoming = withContent.filter(day => day.date >= today);
  return upcoming[0] ?? withContent[0] ?? fallback;
}

export function landingDateDay(input: {
  plan: { startDate: string | null; title: string; notes: string; items: PlanItem[] };
  drafts: DateDaySnapshot[];
  today: string;
}) {
  const current: DateDaySnapshot = {
    date: input.plan.startDate || "",
    title: input.plan.title || DEFAULT_DATE_TITLE,
    notes: input.plan.notes,
    items: input.plan.items,
  };
  const drafts = current.date && hasDateContent(current) ? upsertDateDay(input.drafts, current) : input.drafts;
  return applyDateSwitch({ current, drafts, nextDate: input.today });
}

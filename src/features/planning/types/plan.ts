export type PlanItem = {
  id: string;
  placeId: string;
  placeName: string;
  category: string;
  startTime: string;
  durationMinutes: number;
  expectedCost: number;
  order: number;
  memo: string;
  dayIndex: number;
};

export type CouplePlan = {
  persist: boolean;
  revision: number;
  items: PlanItem[];
  title: string;
  notes: string;
  startDate: string | null;
  dayCount: number;
};

export type PlanKind = "date" | "trip";

export type PlanChange =
  | { type: "remove"; itemId: string; label: string; detail: string }
  | { type: "duration"; itemId: string; minutes: number; label: string; detail: string };

export type PlanOptionStyle = "balanced" | "relaxed" | "budget";

export type PlanOption = {
  key: "A" | "B" | "C";
  style: PlanOptionStyle;
  styleLabel: string;
  title: string;
  summary: string;
  items: PlanItem[];
  totalCost: number;
  placeCount: number;
};

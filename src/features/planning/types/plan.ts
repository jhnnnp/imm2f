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
};

export type PlanKind = "date" | "trip";

export type PlanChange =
  | { type: "remove"; itemId: string; label: string; detail: string }
  | { type: "duration"; itemId: string; minutes: number; label: string; detail: string };

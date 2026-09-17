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
  coordinates?: [number, number] | null;
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

export type AIPlanCondition = {
  dateLabel: string;
  startTime: string;
  endTime: string;
  budget: number | null;
  region: string;
};

export type AIPlaceRecommendation = {
  id: string;
  placeId: string;
  name: string;
  category: string;
  district: string;
  address: string;
  mapUrl: string;
  coordinates: [number, number] | null;
  durationMinutes: number;
  expectedCost: number;
  reasons: string[];
  isSaved: boolean;
  distanceFromPreviousMeters: number | null;
};

export type AIPlannerReply = {
  status: "plan";
  message: string;
  condition: AIPlanCondition;
  recommendations: AIPlaceRecommendation[];
  items: PlanItem[];
  candidateCount: number;
  source: "openai" | "fallback";
  state: AIPlannerState;
};

export type AIPlannerClarification = {
  status: "clarification";
  message: string;
  state: AIPlannerState;
  options: string[];
  multiple: boolean;
};

export type AIPlannerResult = AIPlannerReply | AIPlannerClarification;

export type AIPlannerState = {
  region: string;
  regions: string[];
  requiredPlaces: string[];
  excludedPlaces: string[];
  preferredCategories: string[];
  avoidedCategories: string[];
  pace: "relaxed" | "balanced" | "active";
  preserveExistingPlaces: boolean;
  intent: "create" | "modify" | "remove" | "reset" | "clarify";
  pendingQuestion: string | null;
  conversationNotes: string[];
};

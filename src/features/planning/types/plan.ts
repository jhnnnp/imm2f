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

export type DateActivityId = "cafe" | "meal" | "walk" | "exhibit" | "indoor" | "nightview";
export type DateCuisine = "한식" | "일식" | "중식" | "양식";
export type DateCuisineChoice = DateCuisine | "any";
export type DateTimeWindow = "afternoon" | "evening" | "night" | "any";
export type DateIntakeSlot = "activity" | "area" | "scope" | "span" | "time" | "cuisine" | "indoor";
export type DateStayKind = "date" | "daytrip" | "overnight";
export type DateAreaScope = "core" | "walkable" | "nearby";

export type AIPlanCondition = {
  dateLabel: string;
  startTime: string;
  endTime: string;
  budget: number | null;
  region: string;
  timeSpecified: boolean;
};

export type AIPlaceRecommendation = {
  id: string;
  placeId: string;
  name: string;
  category: string;
  district: string;
  address: string;
  phone: string;
  mapUrl: string;
  coordinates: [number, number] | null;
  durationMinutes: number;
  expectedCost: number;
  reasons: string[];
  isSaved: boolean;
  distanceFromPreviousMeters: number | null;
  rating?: number;
  ratingCount?: number;
  dishes?: string;
  factSourceUrl?: string;
};

export type AIChatStop = {
  name: string;
  meta: string;
  reason?: string;
  mapUrl?: string;
  isSaved?: boolean;
  phone?: string;
  address?: string;
  coordinates?: [number, number] | null;
  dayIndex?: number;
  distanceFromPreviousMeters?: number | null;
  startTime?: string;
  durationMinutes?: number;
  image?: string;
  openingHours?: string;
  source?: "kakao" | "tourapi";
  rating?: number;
  ratingCount?: number;
  dishes?: string;
  factSourceUrl?: string;
};

export type DateChatTurn = {
  role: "user" | "assistant";
  text: string;
};

export type DatePreviousStop = {
  name: string;
  category: string;
};

export type AIChatCard = {
  headline: string;
  lines: string[];
  stops?: AIChatStop[];
  suggestions?: string[];
  followUp?: string;
};

export type AIPlannerReply = {
  status: "plan";
  message: string;
  card: AIChatCard;
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
  card: AIChatCard;
  state: AIPlannerState;
  options: string[];
  multiple: boolean;
  slot: DateIntakeSlot;
};

export type AIPlannerChat = {
  status: "chat";
  message: string;
  card: AIChatCard;
  state: AIPlannerState;
  options?: string[];
  multiple?: boolean;
  slot?: DateIntakeSlot | null;
};

export type AIPlannerResult = AIPlannerReply | AIPlannerClarification | AIPlannerChat;

export type AIPlannerState = {
  activities: DateActivityId[];
  areas: string[];
  region: string;
  regions: string[];
  areaScope: DateAreaScope | null;
  requiredPlaces: string[];
  excludedPlaces: string[];
  cuisine: DateCuisineChoice | null;
  indoorPlay: string | null;
  pace: "relaxed" | "balanced" | "active";
  stayKind: DateStayKind | null;
  nights: number;
  timeWindow: DateTimeWindow | null;
  startTime: string | null;
  endTime: string | null;
  dateLabel: string | null;
  pinOrder: string[];
  preserveExistingPlaces: boolean;
  addStop: boolean;
  intent: "create" | "modify" | "remove" | "reset" | "clarify";
  pendingSlot: DateIntakeSlot | null;
  conversationNotes: string[];
};

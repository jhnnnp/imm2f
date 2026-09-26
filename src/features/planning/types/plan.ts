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

export type DateActivityId = "cafe" | "meal" | "walk" | "exhibit" | "movie" | "performance" | "indoor" | "nightview";
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
  /** Stable experience role for follow-up edits; presentation labels are not a classifier. */
  activitySlot?: DateActivityId | "other";
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
  activitySlot?: DateActivityId | "other";
};

export type AIChatCard = {
  headline: string;
  lines: string[];
  routeBasis?: "straight_line" | "walking";
  stops?: AIChatStop[];
  sources?: Array<{ label: string; url: string }>;
  suggestions?: string[];
  followUp?: string;
};

export type AIPlannerReply = {
  design?: {
    theme: string;
    alternativesConsidered: number;
    routeBasis: "straight_line" | "walking";
    totalDistanceMeters: number;
    evidenceCount: number;
    scoreBreakdown?: { venues: number; evidence: number; diversity: number; route: number; flow: number; violations: number };
    /** Coverage of the selected stops; never a human quality score. */
    evidenceCoverage?: { supportedStops: number; totalStops: number; missingPlaceIds: string[] };
    degraded: boolean;
    rejectionReasons?: string[];
  };
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
  /** The current date's goal, separate from mandatory activities. */
  objective?: string;
  preferences?: {
    vibe: string[];
    novelty?: number;
    intimacy?: number;
    activityLevel?: number;
    crowdTolerance?: number;
    scenicPreference?: number;
    foodImportance?: number;
    walkingTolerance?: number;
  };
  /** Model hypotheses are never promoted to hard constraints. */
  inferredPreferences?: Array<{ value: string; confidence: number; evidence: string }>;
  memorySuggestions?: { activities: DateActivityId[]; cuisine: DateCuisineChoice | null };
  memorySignals?: Array<{ placeName: string; reaction: "crowded" | "liked" | "disliked"; confidence: number }>;
  excludedFoods?: string[];
  foodAllergy?: boolean;
  /** A broad first request has already passed the optional date-focus question. */
  intakeFocusDone?: boolean;
  discovery?: {
    themes: string[];
    priorities: string[];
    queries: Array<{ region: string; query: string }>;
    transport: "walk" | "drive" | "transit";
    requiredActivities: DateActivityId[];
    activityOrder: DateActivityId[];
    minStops: number;
    maxStops: number;
  };
  budgetWon?: number | null;
  walkingPreference?: "short" | null;
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
  /** Exact user-authored turns; never use model summaries to grant exceptions to hard constraints. */
  userRequests?: string[];
  /** Names the assistant listed in the last place-recommendation turn. */
  shownPlaces?: string[];
  /** Prior search results used to avoid repeats; shownPlaces preserves visible numbering. */
  seenPlaces?: string[];
  /** The last standalone place request, so "다른 곳 더" can continue it. */
  placeAsk?: PlaceAsk | null;
};

export type PlaceAskKind = "restaurant" | "cafe" | "bar" | "dessert" | "exhibit" | "activity" | "spot";

export type PlaceAsk = {
  kind: PlaceAskKind;
  /** Dish, cuisine, or vibe words lifted from the user's message. */
  query: string;
  area: string;
};

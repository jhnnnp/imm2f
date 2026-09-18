import type {
  AIPlannerState,
  DateActivityId,
  DateAreaScope,
  DateCuisine,
  DateCuisineChoice,
  DateTimeWindow,
} from "@/features/planning/types/plan";

export type TastePace = "linger" | "mixed" | "walk";
export type TasteSetting = "indoor" | "outdoor" | "mix";
export type TasteCrowd = "quiet" | "lively" | "mix";
export type TasteBudget = "modest" | "comfortable" | "generous";
export type TasteCuisine = DateCuisine | "any";
export type TasteDateFlow = "meal_first" | "cafe_first" | "flex";
export type TasteDrink = "none" | "light" | "any";

export type TasteProfile = {
  areas: string[];
  pace: TastePace;
  activities: DateActivityId[];
  cuisines: TasteCuisine[];
  avoidFoods: string[];
  setting: TasteSetting;
  crowd: TasteCrowd;
  budget: TasteBudget;
  timeWindow: DateTimeWindow;
  areaScope: DateAreaScope;
  dateFlow: TasteDateFlow;
  drink: TasteDrink;
  indoorPlay: string;
  note: string;
};

export type TasteDifference = {
  topic: string;
  you: string;
  partner: string;
  bridge: string;
};

export type TasteCompare = {
  headline: string;
  summary: string;
  overlaps: string[];
  differences: TasteDifference[];
  constraints: string[];
  datePrompt: string;
  seed: TasteDateSeed;
};

export type TasteDateSeed = {
  areas: string[];
  activities: DateActivityId[];
  cuisine: DateCuisineChoice;
  pace: AIPlannerState["pace"];
  timeWindow: DateTimeWindow;
  areaScope: DateAreaScope;
  indoorPlay: string | null;
  stayKind: "date";
  avoidFoods: string[];
  prompt: string;
  headline: string;
  lines: string[];
};

export type TasteBoard = {
  you: TasteProfile | null;
  partner: TasteProfile | null;
  youName: string;
  partnerName: string;
  partnerConnected: boolean;
  compare: TasteCompare | null;
};

export type TasteInput = {
  areas: string[];
  pace: TastePace | "";
  activities: DateActivityId[];
  cuisines: TasteCuisine[];
  avoidFoods: string[];
  setting: TasteSetting | "";
  crowd: TasteCrowd | "";
  budget: TasteBudget | "";
  timeWindow: DateTimeWindow | "";
  areaScope: DateAreaScope | "";
  dateFlow: TasteDateFlow | "";
  drink: TasteDrink | "";
  indoorPlay: string;
  note: string;
};

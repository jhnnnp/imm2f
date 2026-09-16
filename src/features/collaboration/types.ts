import type { PlanItem, PlanKind } from "@/features/planning/types/plan";

export type ActivityAction =
  | "PLACE_ADDED"
  | "PLACE_LIKED"
  | "TRIP_CREATED"
  | "TRIP_UPDATED"
  | "DATE_CREATED"
  | "DATE_UPDATED"
  | "PARTNER_JOINED"
  | "MEMORY_ADDED"
  | "MEMORY_UPDATED"
  | "MEMORY_DELETED"
  | "VAULT_UPDATED"
  | "GIFT_UPDATED"
  | "BUCKET_UPDATED";

export type CoupleActivity = {
  id: string;
  action: string;
  title: string;
  detail: string;
  actorName: string;
  actorUserId: string | null;
  important: boolean;
  createdAt: string;
};

export function hrefForActivity(action: string) {
  if (action.startsWith("TRIP")) return "/trip";
  if (action.startsWith("DATE")) return "/date";
  if (action.startsWith("PLACE")) return "/places";
  if (action.startsWith("MEMORY_")) return "/memories";
  if (action === "VAULT_UPDATED") return "/vault";
  if (action === "GIFT_UPDATED") return "/gifts";
  if (action === "BUCKET_UPDATED") return "/bucket";
  if (action === "PARTNER_JOINED") return "/invite";
  return "/";
}

export type PlanVersion = {
  id: string;
  planKind: PlanKind;
  versionNumber: number;
  changeSummary: string;
  createdByName: string;
  createdAt: string;
  snapshot: PlanItem[];
};

export type BudgetBucketId = "food" | "cafe" | "transport" | "stay" | "tour" | "shop" | "other";

export type BudgetBreakdown = {
  id: BudgetBucketId;
  label: string;
  amount: number;
};

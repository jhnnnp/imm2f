"use client";

export { withoutDismissedActivities } from "./activityFeed";

export const COUPLE_ACTIVITIES_CHANGED = "couple-activities-changed";

export type ActivityChangeDetail = { coupleId?: string; userId?: string; activityOnly?: boolean };

export function emitCoupleActivitiesChanged(detail: ActivityChangeDetail = {}) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<ActivityChangeDetail>(COUPLE_ACTIVITIES_CHANGED, { detail }));
  }
}

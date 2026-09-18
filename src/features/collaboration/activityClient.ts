"use client";

export { withoutDismissedActivities } from "./activityFeed";

export const COUPLE_ACTIVITIES_CHANGED = "couple-activities-changed";

export function emitCoupleActivitiesChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(COUPLE_ACTIVITIES_CHANGED));
  }
}

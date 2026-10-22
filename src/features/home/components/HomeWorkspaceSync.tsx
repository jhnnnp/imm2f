"use client";

import { useRouter } from "next/navigation";
import { useSharedRefresh } from "@/features/collaboration/useSharedRefresh";

/** Home data is owned by Server Components, including its reminders and bucket spotlight. */
export function HomeWorkspaceSync() {
  const router = useRouter();
  useSharedRefresh(async ({ isCurrent }) => {
    if (isCurrent()) router.refresh();
  }, {
    tables: ["places", "place_preferences", "plans", "plan_items", "date_drafts", "memories", "memory_photos", "couple_key_dates", "couple_notes"],
    activityPrefixes: ["PLACE_", "TRIP_", "DATE_", "MEMORY_", "PARTNER_", "COUPLE_DATES_", "BUCKET_"],
  });
  return null;
}

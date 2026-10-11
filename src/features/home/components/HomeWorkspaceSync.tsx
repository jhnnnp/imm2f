"use client";

import { useRouter } from "next/navigation";
import { useSharedRefresh } from "@/features/collaboration/useSharedRefresh";

/** Home data is owned by Server Components, including its separate memory panel. */
export function HomeWorkspaceSync() {
  const router = useRouter();
  useSharedRefresh(async ({ isCurrent }) => {
    if (isCurrent()) router.refresh();
  }, {
    tables: ["places", "place_preferences", "plans", "plan_items", "date_drafts", "memories", "memory_photos"],
    activityPrefixes: ["PLACE_", "TRIP_", "DATE_", "MEMORY_", "PARTNER_"],
  });
  return null;
}

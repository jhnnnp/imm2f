import { AppShell } from "@/components/layout/AppShell";
import { HomeDashboard } from "@/features/home/components/HomeDashboard";
import { ActivityPanel } from "@/features/collaboration/components/ActivityPanel";
import { ActivityPanelServer } from "@/features/collaboration/components/ActivityPanelServer";
import { Suspense } from "react";
import { loadCoupleActivities } from "@/features/collaboration/actions";
import { listMemories } from "@/features/memories/actions";
import { listPlaces } from "@/features/places/actions";
import { loadCouplePlan } from "@/features/planning/actions";

export default async function HomePage() {
  const [placesResult, memoriesResult, trip, date] = await Promise.all([
    listPlaces(),
    listMemories(),
    loadCouplePlan("trip"),
    loadCouplePlan("date"),
  ]);

  return (
    <AppShell context={<Suspense fallback={<ActivityPanel initialItems={[]} />}><ActivityPanelServer /></Suspense>}>
      <HomeDashboard
        places={placesResult.persist ? placesResult.places : []}
        memories={memoriesResult.persist ? memoriesResult.memories : []}
        activities={[]}
        tripItems={trip.items}
        tripTitle={trip.title}
        tripStartDate={trip.startDate}
        tripDayCount={trip.dayCount}
        dateItems={date.items}
        dateTitle={date.title}
        dateStartDate={date.startDate}
      />
    </AppShell>
  );
}

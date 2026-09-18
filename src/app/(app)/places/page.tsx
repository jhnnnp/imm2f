import type { Metadata } from "next";
import { RouteSuspense } from "@/components/layout/RouteSuspense";
import { PlacesExperience } from "@/features/places/components/PlacesExperience";
import { listPlaces } from "@/features/places/actions";
import { listArchivedTripPlans, loadCouplePlan } from "@/features/planning/actions";

export const metadata: Metadata = { title: "Places" };

export default function PlacesPage({ searchParams }: { searchParams: Promise<{ selected?: string }> }) {
  return (
    <RouteSuspense>
      <PlacesPageContent searchParams={searchParams} />
    </RouteSuspense>
  );
}

async function PlacesPageContent({ searchParams }: { searchParams: Promise<{ selected?: string }> }) {
  const params = await searchParams;
  const [{ places, persist }, tripPlan, archivedTrips] = await Promise.all([
    listPlaces(),
    loadCouplePlan("trip"),
    listArchivedTripPlans(),
  ]);
  return (
    <PlacesExperience
      initialPlaces={places}
      persist={persist}
      initialSelectedId={params.selected}
      initialTripItems={tripPlan.items}
      tripPlanTitle={tripPlan.title}
      initialArchivedTrips={archivedTrips}
    />
  );
}

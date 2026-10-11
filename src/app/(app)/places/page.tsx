import type { Metadata } from "next";
import { RouteSuspense } from "@/components/layout/RouteSuspense";
import { PlacesExperience } from "@/features/places/components/PlacesExperience";
import { listPlaces } from "@/features/places/actions";
import { listArchivedTripPlans, loadCouplePlan, readTripDate } from "@/features/planning/actions";
import { listFolderWorkspace } from "@/features/folders/actions";
import { placePlanDestination } from "@/features/places/planDestination";

export const metadata: Metadata = { title: "Places" };

type PlacesParams = { selected?: string; from?: string; day?: string; tripDate?: string };
export default function PlacesPage({ searchParams }: { searchParams: Promise<PlacesParams> }) {
  return (
    <RouteSuspense>
      <PlacesPageContent searchParams={searchParams} />
    </RouteSuspense>
  );
}

async function PlacesPageContent({ searchParams }: { searchParams: Promise<PlacesParams> }) {
  const params = await searchParams;
  const destination = placePlanDestination("trip", params.from === "trip" ? "trip" : null, params.day ?? null, params.tripDate);
  const [{ places, persist }, tripPlan, archivedTrips, folders] = await Promise.all([
    listPlaces(),
    destination.targetDate === undefined ? loadCouplePlan("trip") : readTripDate(destination.targetDate).then(result => result.plan),
    listArchivedTripPlans(),
    listFolderWorkspace("places"),
  ]);
  return (
    <PlacesExperience
      initialPlaces={places}
      persist={persist}
      initialSelectedId={params.selected}
      initialTripItems={tripPlan.items}
      tripPlanTitle={tripPlan.title}
      initialArchivedTrips={archivedTrips}
      initialFolderWorkspace={folders}
    />
  );
}

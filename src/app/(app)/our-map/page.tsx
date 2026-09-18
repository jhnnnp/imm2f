import type { Metadata } from "next";
import { RouteSuspense } from "@/components/layout/RouteSuspense";
import { CoupleMapLazy } from "@/features/map/components/CoupleMapLazy";
import { listMemories } from "@/features/memories/actions";
import { listPlaces } from "@/features/places/actions";
import { listArchivedTripPlans, loadCouplePlan } from "@/features/planning/actions";

export const metadata: Metadata = { title: "Our Map" };

export default function OurMapPage() {
  return (
    <RouteSuspense>
      <OurMapPageContent />
    </RouteSuspense>
  );
}

async function OurMapPageContent() {
  const [{ places }, { memories }, trip, archivedTrips] = await Promise.all([
    listPlaces(),
    listMemories({ photos: "cover" }),
    loadCouplePlan("trip"),
    listArchivedTripPlans(),
  ]);
  return <CoupleMapLazy places={places} memories={memories} trip={trip} archivedTrips={archivedTrips} />;
}

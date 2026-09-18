import type { Metadata } from "next";
import { CoupleMap } from "@/features/map/components/CoupleMap";
import { listMemories } from "@/features/memories/actions";
import { listPlaces } from "@/features/places/actions";
import { listArchivedTripPlans, loadCouplePlan } from "@/features/planning/actions";

export const metadata: Metadata = { title: "Our Map" };

export default async function OurMapPage() {
  const [{ places }, { memories }, trip, archivedTrips] = await Promise.all([listPlaces(), listMemories({ photos: "cover" }), loadCouplePlan("trip"), listArchivedTripPlans()]);
  return <CoupleMap places={places} memories={memories} trip={trip} archivedTrips={archivedTrips} />;
}

import type { Metadata } from "next";
import { TripPlanner } from "@/features/trip/components/TripPlanner";
import { listArchivedTripPlans, loadCouplePlan } from "@/features/planning/actions";

export const metadata: Metadata = { title: "Trip" };

export default async function TripPage() {
  const [plan, archives] = await Promise.all([
    loadCouplePlan("trip"),
    listArchivedTripPlans(),
  ]);

  return <TripPlanner initialPlan={plan} initialArchives={archives} />;
}

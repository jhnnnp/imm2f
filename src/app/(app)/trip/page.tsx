import type { Metadata } from "next";
import { RouteSuspense } from "@/components/layout/RouteSuspense";
import { TripPlanner } from "@/features/trip/components/TripPlanner";
import { listArchivedTripPlans, loadCouplePlan } from "@/features/planning/actions";

export const metadata: Metadata = { title: "Trip" };

export default function TripPage() {
  return (
    <RouteSuspense>
      <TripPageContent />
    </RouteSuspense>
  );
}

async function TripPageContent() {
  const [plan, archives] = await Promise.all([loadCouplePlan("trip"), listArchivedTripPlans()]);
  return <TripPlanner initialPlan={plan} initialArchives={archives} />;
}

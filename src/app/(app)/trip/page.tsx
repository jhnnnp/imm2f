import type { Metadata } from "next";
import { RouteSuspense } from "@/components/layout/RouteSuspense";
import { TripPlanner } from "@/features/trip/components/TripPlanner";
import { listArchivedTripPlans, loadCouplePlan } from "@/features/planning/actions";

export const metadata: Metadata = { title: "Trip" };

export default function TripPage({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  return (
    <RouteSuspense>
      <TripPageContent searchParams={searchParams} />
    </RouteSuspense>
  );
}

async function TripPageContent({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const params = await searchParams;
  const [plan, archives] = await Promise.all([loadCouplePlan("trip"), listArchivedTripPlans()]);
  return <TripPlanner key={params.day ?? "default"} initialDay={Number(params.day) || 0} initialPlan={plan} initialArchives={archives} />;
}

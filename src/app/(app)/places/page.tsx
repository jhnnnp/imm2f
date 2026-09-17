import type { Metadata } from "next";
import { Suspense } from "react";
import { PlacesExperience } from "@/features/places/components/PlacesExperience";
import { listPlaces } from "@/features/places/actions";

export const metadata: Metadata = { title: "Places" };
export default async function PlacesPage({ searchParams }: { searchParams: Promise<{ selected?: string }> }) {
  const params = await searchParams;
  const { places, persist } = await listPlaces();
  return (
    <Suspense>
      <PlacesExperience initialPlaces={places} persist={persist} initialSelectedId={params.selected} />
    </Suspense>
  );
}

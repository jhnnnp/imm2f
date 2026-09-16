import type { Metadata } from "next";
import { Suspense } from "react";
import { PlacesExperience } from "@/features/places/components/PlacesExperience";
import { listPlaces } from "@/features/places/actions";
import { listMemories } from "@/features/memories/actions";

export const metadata: Metadata = { title: "Places" };
export default async function PlacesPage({ searchParams }: { searchParams: Promise<{ selected?: string }> }) {
  const params = await searchParams;
  const [{ places, persist }, { memories }] = await Promise.all([listPlaces(), listMemories()]);
  const memoryCovers = new Map<string, string>();
  memories.forEach(memory => {
    if (memory.placeId && memory.coverUrl && !memoryCovers.has(memory.placeId)) memoryCovers.set(memory.placeId, memory.coverUrl);
  });
  const placesWithMemoryCovers = places.map(place => ({ ...place, image: place.image || memoryCovers.get(place.id) }));
  return (
    <Suspense>
      <PlacesExperience initialPlaces={placesWithMemoryCovers} persist={persist} initialSelectedId={params.selected} />
    </Suspense>
  );
}

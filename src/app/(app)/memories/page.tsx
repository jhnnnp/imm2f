import type { Metadata } from "next";
import { RouteSuspense } from "@/components/layout/RouteSuspense";
import { MemoryTimeline } from "@/features/memories/components/MemoryTimeline";
import { listMemories } from "@/features/memories/actions";
import { listPlaces } from "@/features/places/actions";

export const metadata: Metadata = { title: "Memories" };

export default function MemoriesPage() {
  return (
    <RouteSuspense>
      <MemoriesPageContent />
    </RouteSuspense>
  );
}

async function MemoriesPageContent() {
  const [{ memories, persist }, { places }] = await Promise.all([listMemories(), listPlaces()]);
  return <MemoryTimeline initialMemories={memories} places={places} persist={persist} />;
}

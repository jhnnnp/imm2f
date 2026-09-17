import type { Metadata } from "next";
import { MemoryTimeline } from "@/features/memories/components/MemoryTimeline";
import { listMemories } from "@/features/memories/actions";
import { listPlaces } from "@/features/places/actions";

export const metadata: Metadata = { title: "Memories" };

export default async function MemoriesPage() {
  const [{ memories, persist }, { places }] = await Promise.all([listMemories(), listPlaces()]);
  return <MemoryTimeline initialMemories={memories} places={places} persist={persist} />;
}

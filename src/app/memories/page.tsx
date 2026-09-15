import type { Metadata } from "next";
import { AppShell } from "@/components/layout/AppShell";
import { MemoryTimeline } from "@/features/memories/components/MemoryTimeline";
import { listMemories } from "@/features/memories/actions";
import { listPlaces } from "@/features/places/actions";

export const metadata: Metadata = { title: "Memories" };

export default async function MemoriesPage() {
  const [{ memories, persist }, { places }] = await Promise.all([listMemories(), listPlaces()]);
  return (
    <AppShell>
      <MemoryTimeline initialMemories={memories} places={places} persist={persist} />
    </AppShell>
  );
}

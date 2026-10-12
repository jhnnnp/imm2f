import type { Metadata } from "next";
import { RouteSuspense } from "@/components/layout/RouteSuspense";
import { MemoryTimeline } from "@/features/memories/components/MemoryTimeline";
import { readMemoryWorkspace } from "@/features/memories/actions";

export const metadata: Metadata = { title: "Memories" };

export default function MemoriesPage() {
  return (
    <RouteSuspense>
      <MemoriesPageContent />
    </RouteSuspense>
  );
}

async function MemoriesPageContent() {
  const { memories, persist, places } = await readMemoryWorkspace();
  return <MemoryTimeline initialMemories={memories} places={places} persist={persist} />;
}

import type { Metadata } from "next";
import { AppShell } from "@/components/layout/AppShell";
import { CoupleMap } from "@/features/map/components/CoupleMap";
import { listMemories } from "@/features/memories/actions";
import { listPlaces } from "@/features/places/actions";
import { loadCouplePlan } from "@/features/planning/actions";

export const metadata: Metadata = { title: "Our Map" };

export default async function OurMapPage() {
  const [{ places, persist }, { memories }, trip] = await Promise.all([listPlaces(), listMemories(), loadCouplePlan("trip")]);
  return (
    <AppShell>
      <CoupleMap places={places} memories={memories} trip={trip} persist={persist} />
    </AppShell>
  );
}

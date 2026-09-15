import type { Metadata } from "next";
import { AppShell } from "@/components/layout/AppShell";
import { CoupleMap } from "@/features/map/components/CoupleMap";
import { listMemories } from "@/features/memories/actions";
import { listPlaces } from "@/features/places/actions";

export const metadata: Metadata = { title: "Our Map" };

export default async function OurMapPage() {
  const [{ places }, { memories }] = await Promise.all([listPlaces(), listMemories()]);
  return (
    <AppShell>
      <CoupleMap places={places} memories={memories} />
    </AppShell>
  );
}

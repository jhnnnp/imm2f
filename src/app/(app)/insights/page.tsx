import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAppSession } from "@/features/auth/session";
import { listPlaces } from "@/features/places/actions";
import { loadTasteBoard } from "@/features/taste/actions";
import { TasteStudio } from "@/features/taste/components/TasteStudio";

export const metadata: Metadata = { title: "우리의 취향" };

export default async function InsightsPage() {
  const session = await getAppSession();
  if (session.mode === "guest") redirect("/login?next=/insights");
  const [board, places] = await Promise.all([loadTasteBoard(), listPlaces()]);
  return <TasteStudio initial={board} places={places.places} />;
}

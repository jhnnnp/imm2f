import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { RouteSuspense } from "@/components/layout/RouteSuspense";
import { getAppSession } from "@/features/auth/session";
import { readTasteWorkspace } from "@/features/taste/actions";
import { TasteStudio } from "@/features/taste/components/TasteStudio";

export const metadata: Metadata = { title: "우리의 취향" };

export default function InsightsPage() {
  return (
    <RouteSuspense>
      <InsightsPageContent />
    </RouteSuspense>
  );
}

async function InsightsPageContent() {
  const [session, { board, places }] = await Promise.all([getAppSession(), readTasteWorkspace()]);
  if (session.mode === "guest") redirect("/login?next=/insights");
  return <TasteStudio initial={board} places={places} />;
}

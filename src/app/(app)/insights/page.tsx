import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { RouteSuspense } from "@/components/layout/RouteSuspense";
import { getAppSession } from "@/features/auth/session";
import { readTasteWorkspace } from "@/features/taste/actions";
import { TasteStudio } from "@/features/taste/components/TasteStudio";
import { CoupleKeyDatesSetup } from "@/features/couple/components/CoupleKeyDatesSetup";

export const metadata: Metadata = { title: "우리의 취향" };

export default function InsightsPage() {
  return (
    <>
      <RouteSuspense>
        <InsightsPageContent />
      </RouteSuspense>
      <Suspense fallback={null}><CoupleKeyDatesSetup /></Suspense>
    </>
  );
}

async function InsightsPageContent() {
  const [session, { board, places }] = await Promise.all([getAppSession(), readTasteWorkspace()]);
  if (session.mode === "guest") redirect("/login?next=/insights");
  return <TasteStudio initial={board} places={places} />;
}

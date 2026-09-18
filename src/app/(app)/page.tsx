import { RouteSuspense } from "@/components/layout/RouteSuspense";
import { HomeDashboard } from "@/features/home/components/HomeDashboard";
import { listMemories } from "@/features/memories/actions";
import { listPlaces } from "@/features/places/actions";
import { listDateDrafts, loadCouplePlan } from "@/features/planning/actions";
import { nextUpcomingDate, upsertDateDay, type DateDaySnapshot } from "@/features/date/dateDays";

function seoulTodayIso() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export default function HomePage() {
  return (
    <RouteSuspense>
      <HomePageContent />
    </RouteSuspense>
  );
}

async function HomePageContent() {
  const [placesResult, memoriesResult, trip, date, drafts] = await Promise.all([
    listPlaces(),
    listMemories({ photos: "cover" }),
    loadCouplePlan("trip"),
    loadCouplePlan("date"),
    listDateDrafts(),
  ]);
  const current: DateDaySnapshot = {
    date: date.startDate || "",
    title: date.title,
    notes: date.notes,
    items: date.items,
  };
  const nextDate = nextUpcomingDate(
    date.startDate ? upsertDateDay(drafts, current) : drafts,
    seoulTodayIso(),
    current,
  );

  return (
    <HomeDashboard
      places={placesResult.persist ? placesResult.places : []}
      memories={memoriesResult.persist ? memoriesResult.memories : []}
      activities={[]}
      tripItems={trip.items}
      tripTitle={trip.title}
      tripStartDate={trip.startDate}
      tripDayCount={trip.dayCount}
      dateItems={nextDate.items}
      dateTitle={nextDate.title}
      dateStartDate={nextDate.date || null}
    />
  );
}

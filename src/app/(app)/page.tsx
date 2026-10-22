import { Suspense } from "react";
import { PageLoading } from "@/components/layout/PageLoading";
import { HomeDashboard } from "@/features/home/components/HomeDashboard";
import { MomentLoading } from "@/features/home/components/HomeMoments";
import { HomeUpcomingDays, HomeBucketWish } from "@/features/home/components/HomeMomentsData";
import momentStyles from "@/features/home/components/HomeMoments.module.css";
import { HomeWorkspaceSync } from "@/features/home/components/HomeWorkspaceSync";
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
    <>
      <HomeWorkspaceSync />
      <div className="page-intro home-intro">
        <div>
          <span className="eyebrow">ONLY US</span>
          <h1>오늘도,<br /><em className="home-word is-us">우리</em>의 <em className="home-word is-log">기록</em>은 계속되고 있어요.</h1>
        </div>
        <p className="hand-note">just us.</p>
      </div>
      <Suspense fallback={<PageLoading />}>
        <HomePageContent />
      </Suspense>
      <div className={momentStyles.grid}>
        <Suspense fallback={<MomentLoading kind="dates" />}>
          <HomeUpcomingDays />
        </Suspense>
        <Suspense fallback={<MomentLoading kind="wish" />}>
          <HomeBucketWish />
        </Suspense>
      </div>
    </>
  );
}

async function HomePageContent() {
  const [placesResult, trip, date, drafts] = await Promise.all([
    listPlaces(),
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

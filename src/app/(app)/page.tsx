import { Suspense } from "react";
import { PageLoading } from "@/components/layout/PageLoading";
import { HomeDashboard } from "@/features/home/components/HomeDashboard";
import { HomeRecentMemory } from "@/features/home/components/HomeRecentMemory";
import { RecentActivityPreview } from "@/features/collaboration/components/RecentActivityPreview";
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

function HomeMemoryLoading() {
  return (
    <section className="recent-memory paper-card" aria-busy="true">
      <div className="section-heading compact">
        <div><span className="eyebrow">RECENT MEMORY</span><h2>가장 가까운 장면</h2></div>
      </div>
      <p className="form-hint">기억을 불러오는 중이에요.</p>
    </section>
  );
}

export default function HomePage() {
  return (
    <>
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
      <div className="home-bottom-grid">
        <Suspense fallback={<HomeMemoryLoading />}>
          <HomeMemoryContent />
        </Suspense>
        <section className="activity-preview paper-card">
          <div className="section-heading compact">
            <div><span className="eyebrow">RECENT ACTIVITY</span><h2>우리의 최근 변화</h2></div>
          </div>
          <RecentActivityPreview />
        </section>
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

async function HomeMemoryContent() {
  const result = await listMemories({ photos: "cover" });
  return <HomeRecentMemory memories={result.persist ? result.memories : []} />;
}

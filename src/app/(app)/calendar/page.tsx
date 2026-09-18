import { RouteSuspense } from "@/components/layout/RouteSuspense";
import { loadCouplePlan } from "@/features/planning/actions";
import { listMemoryCalendarMarks } from "@/features/memories/actions";
import { CalendarBoard } from "@/features/calendar/components/CalendarBoard";

export default function CalendarPage() {
  return (
    <RouteSuspense>
      <CalendarPageContent />
    </RouteSuspense>
  );
}

async function CalendarPageContent() {
  const [trip, date, memories] = await Promise.all([
    loadCouplePlan("trip"),
    loadCouplePlan("date"),
    listMemoryCalendarMarks(),
  ]);
  return (
    <>
      <div className="page-title-row">
        <div>
          <span className="eyebrow">CALENDAR</span>
          <h1>우리의캘린더</h1>
          <p>날짜를 고르면 여행·데이트·추억이 붙고, 빈 날은 시작일로 지정할 수 있어요.</p>
        </div>
      </div>
      <CalendarBoard trip={trip} date={date} memories={memories} />
    </>
  );
}

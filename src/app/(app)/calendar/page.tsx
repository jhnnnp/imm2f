import { RouteSuspense } from "@/components/layout/RouteSuspense";
import { listDateDrafts, loadCouplePlan } from "@/features/planning/actions";
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
  const [trip, date, memories, drafts] = await Promise.all([
    loadCouplePlan("trip"),
    loadCouplePlan("date"),
    listMemoryCalendarMarks(),
    listDateDrafts(),
  ]);
  return (
    <>
      <div className="page-title-row">
        <div>
          <span className="eyebrow">CALENDAR</span>
          <h1>우리의캘린더</h1>
          <p>함께할 약속과 함께한 기억을 한 달씩 펼쳐 보세요.</p>
        </div>
      </div>
      <CalendarBoard trip={trip} date={date} memories={memories} drafts={drafts} />
    </>
  );
}

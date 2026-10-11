import type { Metadata } from "next";
import { RouteSuspense } from "@/components/layout/RouteSuspense";
import { readCalendarWorkspace } from "@/features/collaboration/workspaceReads";
import { CalendarBoard } from "@/features/calendar/components/CalendarBoard";

export const metadata: Metadata = { title: "우리의 캘린더" };

export default function CalendarPage() {
  return (
    <RouteSuspense>
      <CalendarPageContent />
    </RouteSuspense>
  );
}

async function CalendarPageContent() {
  const { trip, date, memories, drafts, tripDrafts, archives } = await readCalendarWorkspace();
  return (
    <>
      <div className="page-title-row">
        <div>
          <span className="eyebrow">CALENDAR</span>
          <h1>우리의 캘린더</h1>
          <p>함께할 약속과 함께한 기억을 한 달씩 펼쳐 보세요.</p>
        </div>
      </div>
      <CalendarBoard trip={trip} date={date} memories={memories} drafts={drafts} tripDrafts={tripDrafts} archives={archives} />
    </>
  );
}

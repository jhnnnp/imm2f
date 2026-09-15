import { AppShell } from "@/components/layout/AppShell";
import { loadCouplePlan } from "@/features/planning/actions";
import { listMemories } from "@/features/memories/actions";
import { CalendarBoard } from "@/features/calendar/components/CalendarBoard";

export default async function CalendarPage() {
  const [trip, date, memories] = await Promise.all([loadCouplePlan("trip"), loadCouplePlan("date"), listMemories()]);
  return (
    <AppShell>
      <div className="page-title-row">
        <div>
          <span className="eyebrow">CALENDAR</span>
          <h1>둘의 캘린더</h1>
          <p>날짜를 고르면 여행·데이트·추억이 붙고, 빈 날은 시작일로 지정할 수 있어요.</p>
        </div>
      </div>
      <CalendarBoard
        trip={trip}
        date={date}
        memories={memories.memories.map(item => ({ id: item.id, title: item.title, happenedOn: item.happenedOn }))}
      />
    </AppShell>
  );
}

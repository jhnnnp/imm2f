import Link from "next/link";
import type { Place } from "@/features/places/types/place";
import type { Memory } from "@/features/memories/types";
import type { PlanItem } from "@/features/planning/types/plan";
import { hrefForActivity, type CoupleActivity } from "@/features/collaboration/types";
import { formatKoDate, formatKoShort, formatWon } from "@/lib/dates";

function bothWant(place: Place) {
  const positive = ["want", "must_visit", "revisit"];
  return positive.includes(place.userStatus) && positive.includes(place.partnerStatus);
}

export function HomeDashboard({
  places,
  memories,
  activities,
  tripItems,
  tripTitle,
  tripStartDate,
  tripDayCount,
  dateItems,
  dateTitle,
  dateStartDate,
}: {
  places: Place[];
  memories: Memory[];
  activities: CoupleActivity[];
  tripItems: PlanItem[];
  tripTitle: string;
  tripStartDate: string | null;
  tripDayCount: number;
  dateItems: PlanItem[];
  dateTitle: string;
  dateStartDate: string | null;
}) {
  const shared = places.filter(bothWant).slice(0, 3);
  const mine = places.filter(place => ["want", "must_visit", "revisit"].includes(place.userStatus)).slice(0, 3);
  const shownPlaces = shared.length ? shared : mine;
  const memory = memories[0] ?? null;
  const tripCost = tripItems.reduce((sum, item) => sum + item.expectedCost, 0);
  const dateCost = dateItems.reduce((sum, item) => sum + item.expectedCost, 0);

  return (
    <>
      <div className="page-intro home-intro">
        <div>
          <span className="eyebrow">ONLY US</span>
          <h1>오늘도,<br />우리의 기록은 계속되고 있어요.</h1>
        </div>
        <p className="hand-note">just us.</p>
      </div>
      <div className="home-layout">
        <Link className={`next-journey visual-card ${tripItems.length ? "" : "is-empty"}`} href="/trip">
          <div className="image-shade" />
          {tripItems.length ? (
            <div className="journey-copy">
              <div><span className="light-label">NEXT JOURNEY</span><b className="d-day">{tripDayCount > 1 ? `${tripDayCount}일` : `${tripItems.length}곳`}</b></div>
              <h2>{tripTitle || "우리가 고른 여행"}</h2>
              <p>{tripItems.map(item => item.placeName).slice(0, 3).join(" · ")}</p>
              <div className="plan-progress"><i style={{ width: `${Math.min(100, Math.max(12, tripItems.length * 16))}%` }} /></div>
              <small>{tripStartDate ? `${formatKoShort(tripStartDate)} 출발 · ` : ""}{tripDayCount > 1 ? `${tripDayCount}일 · ` : ""}{tripCost ? `예상 ₩${formatWon(tripCost)}` : `${tripItems.length}곳 초안`}</small>
            </div>
          ) : (
            <div className="journey-copy">
              <span className="light-label">NEXT JOURNEY</span>
              <h2>아직 잡아 둔 여행이 없어요</h2>
              <p>저장한 장소로 첫날을 만들어 보세요.</p>
              <span className="text-link">여행 일정 열기 →</span>
            </div>
          )}
        </Link>
        <div className="home-side-stack">
          <Link className="next-date paper-card" href="/date">
            <span className="eyebrow">NEXT DATE</span>
            {dateItems.length ? (
              <div>
                <div className="date-leaf"><b>{dateItems.length}</b><small>곳</small></div>
                <div>
                  <h3>{dateTitle || "우리가 고른 데이트"}</h3>
                  <p>{dateStartDate ? formatKoDate(dateStartDate) : `${dateItems[0]?.placeName}에서 시작`}</p>
                  <strong>{dateCost ? `예상 ₩${formatWon(dateCost)}` : "초안 저장됨"}</strong>
                </div>
              </div>
            ) : (
              <div>
                <div className="date-leaf"><b>?</b><small>DATE</small></div>
                <div>
                  <h3>다음 데이트를 아직 안 잡았어요</h3>
                  <p>장소에서 담고, AI로 3안을 만들어 보세요.</p>
                </div>
              </div>
            )}
          </Link>
          <Link className="ai-nudge paper-card" href="/places">
            <div>
              <span className="eyebrow">A NOTE FOR US</span>
              <h3>이번엔 둘 다 좋아할 장소를 찾아볼까요?</h3>
              <span className="text-link">장소 찾기 →</span>
            </div>
          </Link>
        </div>
      </div>

      <div className="section-heading">
        <div>
          <span className="eyebrow">BOTH OF US</span>
          <h2>{shared.length ? "둘 다 가고 싶은 곳" : "내가 담아 둔 곳"}</h2>
        </div>
        <Link className="quiet-link" href="/places">모두 보기 →</Link>
      </div>
      {shownPlaces.length ? (
        <div className="place-strip">
          {shownPlaces.map(place => (
            <Link className={`mini-place tone-${place.visualTone}`} href={`/places?selected=${place.id}`} key={place.id}>
              {place.image ? <img src={place.image} alt={place.name} /> : <div className="abstract-photo">{place.categoryLabel}</div>}
              <div>
                <span>{place.categoryLabel} · {place.district}</span>
                <h3>{place.name}</h3>
                <p>{shared.length ? "둘 다 가고 싶어요" : "내가 저장한 장소"}</p>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <p className="form-hint home-empty-hint">아직 겹치는 장소가 없어요. 각자 가고 싶은 곳을 저장하면 여기에 모여요.</p>
      )}

      <div className="home-bottom-grid">
        <section className="recent-memory paper-card">
          <div className="section-heading compact">
            <div>
              <span className="eyebrow">RECENT MEMORY</span>
              <h2>{memory?.title ?? "아직 남긴 추억이 없어요"}</h2>
            </div>
            <Link className="quiet-link" href="/memories">{memory ? "열어보기 →" : "남기러 가기 →"}</Link>
          </div>
          {memory ? (
            <div className="memory-row">
              {memory.coverUrl ? <img src={memory.coverUrl} alt={memory.title} /> : <div className="abstract-photo">{memory.locationLabel || "memory"}</div>}
              <div>
                <p>{memory.description || "둘만 아는 그날의 장면."}</p>
                <small>{memory.happenedOn ? formatKoDate(memory.happenedOn) : ""}{memory.locationLabel ? ` · ${memory.locationLabel}` : ""}</small>
              </div>
            </div>
          ) : (
            <p className="form-hint">다녀온 날을 짧게 적어두면, 홈에서 다시 만나요.</p>
          )}
        </section>
        <section className="activity-preview paper-card">
          <div className="section-heading compact">
            <div>
              <span className="eyebrow">RECENT ACTIVITY</span>
              <h2>둘의 최근 변화</h2>
            </div>
          </div>
          {activities.length ? activities.slice(0, 4).map(item => (
            <Link className="activity-line" href={hrefForActivity(item.action)} key={item.id}>
              <span className="avatar you">{item.actorName.slice(0, 1)}</span>
              <p><b>{item.title}</b><small>{item.detail || item.actorName}</small></p>
              <time suppressHydrationWarning>{item.createdAt}</time>
            </Link>
          )) : (
            <p className="form-hint">장소를 저장하거나 일정을 바꾸면 여기에 쌓여요.</p>
          )}
        </section>
      </div>
    </>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Place } from "@/features/places/types/place";
import type { Memory } from "@/features/memories/types";
import type { PlanItem } from "@/features/planning/types/plan";
import { hrefForActivity, type CoupleActivity } from "@/features/collaboration/types";
import { formatKoDate, formatKoShort } from "@/lib/dates";
import { RecentActivityPreview } from "@/features/collaboration/components/RecentActivityPreview";
import { useAppSession } from "@/features/auth/components/SessionProvider";
import { getDemoPlaces, subscribeDemoPlaces } from "@/features/places/demoPlaces";
import { getDraftDateItems, getDraftPlanMeta, getDraftTripItems, hasStoredDraftPlan, subscribeDraftTrip } from "@/features/planning/draftTrip";

function bothWant(place: Place) {
  const positive = ["want", "must_visit", "revisit"];
  return positive.includes(place.userStatus) && positive.includes(place.partnerStatus);
}

function dayLabel(date: string | null) {
  if (!date) return "PLAN";
  const target = new Date(`${date}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const difference = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (difference === 0) return "D-DAY";
  return difference > 0 ? `D-${difference}` : `D+${Math.abs(difference)}`;
}

function withSubjectParticle(name: string) {
  const last = name.trim().at(-1);
  if (!last) return "파트너가";
  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return `${name}이`;
  return `${name}${(code - 0xac00) % 28 === 0 ? "가" : "이"}`;
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
  const session = useAppSession();
  const [livePlaces, setLivePlaces] = useState(places);
  const [liveTrip, setLiveTrip] = useState({ items: tripItems, title: tripTitle, startDate: tripStartDate, dayCount: tripDayCount });
  const [liveDate, setLiveDate] = useState({ items: dateItems, title: dateTitle, startDate: dateStartDate });

  useEffect(() => {
    const syncLocal = () => {
      if (!places.length) {
        const localPlaces = getDemoPlaces();
        if (localPlaces.length) setLivePlaces(localPlaces);
      }
      if (!tripItems.length && hasStoredDraftPlan("trip")) {
        const meta = getDraftPlanMeta("trip");
        setLiveTrip({ items: getDraftTripItems(), title: meta.title, startDate: meta.startDate || null, dayCount: meta.dayCount });
      }
      if (!dateItems.length && hasStoredDraftPlan("date")) {
        const meta = getDraftPlanMeta("date");
        setLiveDate({ items: getDraftDateItems(), title: meta.title, startDate: meta.startDate || null });
      }
    };
    syncLocal();
    const unsubscribePlans = subscribeDraftTrip(syncLocal);
    const unsubscribePlaces = subscribeDemoPlaces(syncLocal);
    return () => {
      unsubscribePlans();
      unsubscribePlaces();
    };
  }, [places, tripItems, dateItems]);

  const shared = livePlaces.filter(bothWant).slice(0, 3);
  const mine = livePlaces.filter(place => ["want", "must_visit", "revisit"].includes(place.userStatus)).slice(0, 3);
  const partnerOnly = livePlaces.filter(place =>
    ["want", "must_visit", "revisit"].includes(place.partnerStatus)
    && !["want", "must_visit", "revisit"].includes(place.userStatus),
  ).slice(0, 3);
  const partnerName = session.mode === "authenticated" ? session.partner?.displayName?.trim() || "파트너" : "파트너";
  const shownPlaces = shared.length ? shared : mine;
  const memory = memories[0] ?? null;

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
        <Link className={`next-journey visual-card ${liveTrip.items.length ? "" : "is-empty"}`} href="/trip">
          <div className="image-shade" />
          {liveTrip.items.length ? (
            <div className="journey-copy">
              <div className="journey-topline">
                <span className="light-label">NEXT JOURNEY</span>
                <div className="journey-countdown" aria-label={liveTrip.startDate ? `${formatKoShort(liveTrip.startDate)}까지 ${dayLabel(liveTrip.startDate)}` : "여행 날짜 미정"}>
                  <span>TO GO</span><b>{dayLabel(liveTrip.startDate)}</b><small>{liveTrip.startDate ? formatKoShort(liveTrip.startDate) : "날짜 미정"}</small>
                </div>
              </div>
              <h2>{liveTrip.title || "우리가 고른 여행"}</h2>
              <p>{liveTrip.items.map(item => item.placeName).slice(0, 3).join(" · ")}</p>
              <div className="journey-route" aria-hidden="true"><i /><span>첫날의 설렘부터</span><i /><span>마지막 노을까지</span></div>
              <div className="plan-progress"><i style={{ width: `${Math.min(100, Math.max(12, liveTrip.items.length * 16))}%` }} /></div>
              <div className="journey-footer"><small>{liveTrip.dayCount > 1 ? `${liveTrip.dayCount}일 동안의 여정` : "우리만의 작은 여행"}</small><b>{liveTrip.items.length} places&nbsp; →</b></div>
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
            <div className="date-card-head"><span className="eyebrow">OUR NEXT DATE</span><span className="date-card-spark" aria-hidden="true">✦</span></div>
            {liveDate.items.length ? (
              <div className="date-card-main">
                <div className="date-leaf"><b>{liveDate.items.length}</b><small>곳</small></div>
                <div>
                  <h3>{liveDate.title || "우리가 고른 데이트"}</h3>
                  <p>{liveDate.startDate ? formatKoDate(liveDate.startDate) : `${liveDate.items[0]?.placeName}에서 시작`}</p>
                  <span className="date-card-link">일정 살펴보기 <b>→</b></span>
                </div>
              </div>
            ) : (
              <div className="date-card-main">
                <div className="date-leaf"><b>?</b><small>DATE</small></div>
                <div>
                  <h3>다음 데이트를 아직 안 잡았어요</h3>
                  <p>장소에서 담고, AI로 3안을 만들어 보세요.</p>
                  <span className="date-card-link">데이트 만들기 <b>→</b></span>
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

      {session.mode === "authenticated" && session.partner && (
        <section className="partner-picks-section">
          <div className="section-heading partner-picks-heading">
            <div>
              <span className="eyebrow">FROM YOUR PARTNER</span>
              <h2>{withSubjectParticle(partnerName)} 담아 둔 곳</h2>
            </div>
            <Link className="quiet-link" href="/places">더 둘러보기 →</Link>
          </div>
          {partnerOnly.length ? (
            <div className="place-strip partner-place-strip">
              {partnerOnly.map(place => (
                <Link className={`mini-place tone-${place.visualTone}`} href={`/places?selected=${place.id}`} key={`partner-${place.id}`}>
                  {place.image ? <img src={place.image} alt={place.name} /> : <div className="abstract-photo">{place.categoryLabel}</div>}
                  <div>
                    <span>{place.categoryLabel} · {place.district}</span>
                    <h3>{place.name}</h3>
                    <p>{partnerName}의 저장 장소</p>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="partner-picks-empty">
              <span aria-hidden="true">＋</span>
              <p><b>{partnerName}의 장소를 기다리고 있어요.</b><small>파트너가 가고 싶은 곳을 고르면 여기에 따로 모아드려요.</small></p>
            </div>
          )}
        </section>
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
          <RecentActivityPreview />
        </section>
      </div>
    </>
  );
}

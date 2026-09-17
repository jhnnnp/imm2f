"use client";

import Link from "next/link";
import type { Place } from "@/features/places/types/place";
import type { Memory } from "@/features/memories/types";
import type { PlanItem } from "@/features/planning/types/plan";
import { type CoupleActivity } from "@/features/collaboration/types";
import type { PlaceCategoryId } from "@/features/places/types/place";
import { PLACE_CATEGORIES } from "@/features/places/config/placeCategories";
import { addDays, formatKoDate, formatKoShort, toIsoDate } from "@/lib/dates";
import { RecentActivityPreview } from "@/features/collaboration/components/RecentActivityPreview";
import { useAppSession } from "@/features/auth/components/SessionProvider";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const CATEGORY_IDS = new Set(PLACE_CATEGORIES.map(item => item.id));

function bothWant(place: Place) {
  const positive = ["want", "must_visit", "revisit"];
  return positive.includes(place.userStatus) && positive.includes(place.partnerStatus);
}

function seoulDateIso(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function dayLabel(date: string | null) {
  if (!date) return "PLAN";
  const today = seoulDateIso();
  const start = Date.parse(`${today}T00:00:00+09:00`);
  const target = Date.parse(`${date}T00:00:00+09:00`);
  if (!Number.isFinite(start) || !Number.isFinite(target)) return "PLAN";
  const difference = Math.round((target - start) / 86_400_000);
  if (difference === 0) return "D-DAY";
  return difference > 0 ? `D-${difference}` : `D+${Math.abs(difference)}`;
}

function stayWord(dayCount: number) {
  if (dayCount <= 1) return "하루";
  if (dayCount === 2) return "이틀";
  if (dayCount === 3) return "사흘";
  return `${dayCount}일`;
}

function journeyHeadline(title: string, items: PlanItem[], places: Place[], dayCount: number) {
  const trimmed = title.trim();
  if (trimmed && trimmed !== "우리가 고른 여행") return trimmed;
  const byId = new Map(places.map(place => [place.id, place]));
  const first = items[0] ? byId.get(items[0].placeId) : undefined;
  const district = first?.district?.replace(/시$|군$|구$/u, "") || first?.name;
  if (!district) return trimmed || "우리가 고른 여행";
  return dayCount <= 1 ? `${district}에서의 하루` : `${district}에서 머문 ${stayWord(dayCount)}`;
}

function withSubjectParticle(name: string) {
  const last = name.trim().at(-1);
  if (!last) return "파트너가";
  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return `${name}이`;
  return `${name}${(code - 0xac00) % 28 === 0 ? "가" : "이"}`;
}

function memoryCover(memory: Memory) {
  if (memory.coverUrl) return { kind: "image" as const, src: memory.coverUrl };
  const photo = memory.photos.find(item => item.storageUrl)?.storageUrl;
  if (photo) return { kind: "image" as const, src: photo };
  return { kind: "letter" as const };
}

function tripRange(startDate: string | null, dayCount: number) {
  if (!startDate || dayCount < 1) return [];
  return Array.from({ length: Math.max(1, dayCount) }, (_, index) => addDays(startDate, index));
}

function MiniCal({ startDate, dayCount }: { startDate: string | null; dayCount: number }) {
  const focus = startDate || seoulDateIso();
  const focusDate = new Date(`${focus}T12:00:00`);
  if (Number.isNaN(focusDate.getTime())) return null;
  const year = focusDate.getFullYear();
  const month = focusDate.getMonth();
  const first = new Date(year, month, 1);
  const gridStart = new Date(first);
  gridStart.setDate(1 - first.getDay());
  const selected = new Set(tripRange(startDate, dayCount));
  const today = seoulDateIso();
  const cells = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    const iso = toIsoDate(date);
    return {
      iso,
      day: date.getDate(),
      outside: date.getMonth() !== month,
      trip: selected.has(iso),
      start: iso === startDate,
      today: iso === today,
    };
  });
  const lastWeek = cells.slice(35);
  const days = lastWeek.every(cell => cell.outside) ? cells.slice(0, 35) : cells;
  return (
    <div className="home-mini-cal" aria-hidden="true">
      <div className="home-mini-cal-weekdays">
        {WEEKDAYS.map(day => <span key={day}>{day}</span>)}
      </div>
      <div className="home-mini-cal-days">
        {days.map(cell => (
          <span
            key={cell.iso}
            className={[
              cell.outside ? "is-out" : "",
              cell.start ? "is-start" : cell.trip ? "is-trip" : "",
              cell.today && !cell.start ? "is-today" : "",
            ].filter(Boolean).join(" ") || undefined}
          >
            {cell.day}
          </span>
        ))}
      </div>
    </div>
  );
}

function stopCategory(item: PlanItem, place?: Place): PlaceCategoryId {
  if (place?.category) return place.category;
  if (CATEGORY_IDS.has(item.category as PlaceCategoryId)) return item.category as PlaceCategoryId;
  const label = `${item.category}${place?.categoryLabel ?? ""}`;
  if (label.includes("카페")) return "cafe";
  if (label.includes("책")) return "book";
  if (label.includes("사진")) return "photo";
  if (label.includes("숙")) return "stay";
  if (label.includes("축제")) return "festival";
  if (label.includes("산책") || label.includes("공원") || label.includes("자연")) return "nature";
  if (label.includes("맛집") || label.includes("한식") || label.includes("일식") || label.includes("중식") || label.includes("양식") || label.includes("식당")) return "restaurant";
  return "tourist";
}

function StopMark({ category }: { category: PlaceCategoryId }) {
  return (
    <span className={`home-stop-mark is-${category}`}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {category === "cafe" ? <path d="M6 9h10v6a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4V9Zm10 1h2.2A2.8 2.8 0 0 1 19 12.8 2.8 2.8 0 0 1 16.2 16H16M8 5.5c.8 1 1.6 1 2.4 0M12 5.5c.8 1 1.6 1 2.4 0" /> : null}
        {category === "restaurant" ? <path d="M5 10.5h14v1.6a7 7 0 0 1-14 0v-1.6ZM8 10.5V8m8 2.5V8M7 8h10" /> : null}
        {category === "book" ? <path d="M12 6.5c-1.6-1-3.7-1.4-6-.8V19c2.4-.6 4.5-.2 6 .8 1.6-1 3.7-1.4 6-.8V5.7c-2.4-.6-4.5-.2-6 .8Z" /> : null}
        {category === "nature" ? <path d="M12 20V11M7 16c1.8-5 5-8 5-8s3.2 3 5 8M5 20h14" /> : null}
        {category === "photo" ? <path d="M8 8.5 9.2 6h5.6L16 8.5h2.5A1.5 1.5 0 0 1 20 10v8.5A1.5 1.5 0 0 1 18.5 20h-13A1.5 1.5 0 0 1 4 18.5V10a1.5 1.5 0 0 1 1.5-1.5H8Zm4 9.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z" /> : null}
        {category === "stay" ? <path d="M4 20V10l8-5 8 5v10M8 20v-6h8v6" /> : null}
        {category === "festival" ? <path d="M7 4v16M7 6c4 2.4 6-2.4 10 0v8c-4-2.4-6 2.4-10 0" /> : null}
        {category === "tourist" ? <path d="M12 21s6-5.2 6-10a6 6 0 1 0-12 0c0 4.8 6 10 6 10Zm0-8.2a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6Z" /> : null}
      </svg>
    </span>
  );
}

const PASS_SPINE_HOLES = 11;

function PassSpine() {
  return (
    <div className="home-pass-spine" aria-hidden="true">
      {Array.from({ length: PASS_SPINE_HOLES }, (_, index) => <span key={index} />)}
    </div>
  );
}

function DateLeaf({
  empty,
  label,
}: {
  empty: boolean;
  label: string;
}) {
  return (
    <span className={`date-leaf${empty ? " is-empty" : ""}`} aria-hidden="true">
      <b>{empty ? "?" : label}</b>
      <small>DATE</small>
    </span>
  );
}

function EmptyRoute() {
  const slots = [
    { title: "첫 장소를 고르면", meta: "일정 1" },
    { title: "그다음 코스가", meta: "일정 2" },
    { title: "여기에 쌓여요", meta: "일정 3" },
  ];
  return (
    <ol className="home-route is-empty">
      {slots.map((slot, index) => (
        <li key={slot.meta}>
          <span className="home-stop-mark is-ghost">{String(index + 1).padStart(2, "0")}</span>
          <span className="home-stop-copy">
            <b>{slot.title}</b>
            <small>{slot.meta}</small>
          </span>
        </li>
      ))}
    </ol>
  );
}

function RouteList({
  items,
  places,
  limit,
  showDays = false,
}: {
  items: PlanItem[];
  places: Place[];
  limit: number;
  showDays?: boolean;
}) {
  const byId = new Map(places.map(place => [place.id, place]));
  const stops = items.slice(0, limit);
  return (
    <ol className="home-route">
      {stops.map((item, index) => {
        const place = byId.get(item.placeId);
        const previous = stops[index - 1];
        const showDay = Boolean(showDays && (index === 0 || previous?.dayIndex !== item.dayIndex));
        const meta = [place?.categoryLabel || item.category, place?.district].filter(Boolean).join(" · ");
        return (
          <li key={item.id} className={showDay ? "has-day" : undefined}>
            {showDay ? <span className="home-route-day">{item.dayIndex + 1}일차</span> : null}
            <StopMark category={stopCategory(item, place)} />
            <span className="home-stop-copy">
              <b>{item.placeName}</b>
              {meta ? <small>{meta}</small> : null}
            </span>
            {item.startTime ? <time dateTime={item.startTime}>{item.startTime}</time> : null}
          </li>
        );
      })}
    </ol>
  );
}

function PlaceIndexCard({
  place,
  href,
  note,
  index,
}: {
  place: Place;
  href: string;
  note: string;
  index: number;
}) {
  return (
    <Link className={`home-index tilt-${index % 3} tone-${place.visualTone}`} href={href} style={{ animationDelay: `${index * 70}ms` }}>
      <span className="home-index-stamp" aria-hidden="true">{place.categoryLabel.slice(0, 1)}</span>
      <small>{place.categoryLabel} · {place.district}</small>
      <h3>{place.name}</h3>
      <p>{note}</p>
    </Link>
  );
}

export function HomeDashboard({
  places,
  memories,
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
  const livePlaces = places;
  const liveTrip = { items: tripItems, title: tripTitle, startDate: tripStartDate, dayCount: tripDayCount };
  const liveDate = { items: dateItems, title: dateTitle, startDate: dateStartDate };

  const shared = livePlaces.filter(bothWant).slice(0, 3);
  const mine = livePlaces.filter(place => ["want", "must_visit", "revisit"].includes(place.userStatus)).slice(0, 3);
  const partnerOnly = livePlaces.filter(place =>
    ["want", "must_visit", "revisit"].includes(place.partnerStatus)
    && !["want", "must_visit", "revisit"].includes(place.userStatus),
  ).slice(0, 3);
  const partnerName = session.mode === "authenticated" ? session.partner?.displayName?.trim() || "파트너" : "파트너";
  const shownPlaces = shared.length ? shared : mine;
  const memory = memories[0] ?? null;
  const cover = memory ? memoryCover(memory) : null;
  const heading = journeyHeadline(liveTrip.title, liveTrip.items, livePlaces, liveTrip.dayCount);
  const tripShown = Math.min(5, liveTrip.items.length);
  const tripMore = Math.max(0, liveTrip.items.length - tripShown);
  const dateStops = liveDate.items.map(item => item.placeName).slice(0, 3).join(" - ");

  return (
    <>
      <div className="page-intro home-intro">
        <div>
          <span className="eyebrow">ONLY US</span>
          <h1>오늘도,<br /><em className="home-word is-us">우리</em>의 <em className="home-word is-log">기록</em>은 계속되고 있어요.</h1>
        </div>
        <p className="hand-note">just us.</p>
      </div>
      <div className="home-layout">
        <Link
          className={`home-pass${liveTrip.items.length ? "" : " is-empty"}`}
          href="/trip"
          aria-label={liveTrip.items.length ? `다음 여행, ${heading}` : "여행 일정 열기"}
        >
          <div className="home-pass-stub">
            <span className="light-label">NEXT JOURNEY</span>
            {liveTrip.items.length ? (
              <>
                <h2>{heading}</h2>
                <div className="home-pass-dday">
                  <b>{dayLabel(liveTrip.startDate)}</b>
                  <small>{liveTrip.startDate ? formatKoShort(liveTrip.startDate) : "날짜 미정"}</small>
                </div>
                <MiniCal startDate={liveTrip.startDate} dayCount={liveTrip.dayCount} />
                <span className="home-pass-count">{liveTrip.dayCount > 1 ? `${liveTrip.dayCount}일 · ${liveTrip.items.length}곳` : `${liveTrip.items.length}곳으로 떠난 하루`}</span>
              </>
            ) : (
              <>
                <h2>아직 잡아 둔 여행이 없어요</h2>
                <p>저장한 장소로 첫날을 만들어 보세요.</p>
                <MiniCal startDate={seoulDateIso()} dayCount={0} />
                <span className="home-pass-count">일정 없음</span>
              </>
            )}
          </div>
          <PassSpine />
          <div className="home-pass-route">
            {liveTrip.items.length ? (
              <>
                <div className="home-pass-route-head">
                  <span className="eyebrow">ITINERARY</span>
                  <b>{liveTrip.items.length} STOP{liveTrip.items.length > 1 ? "S" : ""}</b>
                </div>
                <RouteList items={liveTrip.items} places={livePlaces} limit={tripShown} showDays={liveTrip.dayCount > 1} />
                <span className="home-pass-more">{tripMore ? `${tripMore}곳 더 보기` : "일정 열기"}</span>
              </>
            ) : (
              <>
                <div className="home-pass-route-head">
                  <span className="eyebrow">ITINERARY</span>
                  <b>0 STOPS</b>
                </div>
                <EmptyRoute />
                <span className="home-pass-more">여행 만들기</span>
              </>
            )}
          </div>
        </Link>
        <div className="home-side-stack">
          <Link
            className="home-date paper-card"
            href="/date"
            aria-label={liveDate.items.length ? `다음 데이트, ${liveDate.title || "우리가 고른 데이트"}` : "데이트 일정 열기"}
          >
            <span className="home-pin is-left" aria-hidden="true" />
            <span className="home-pin is-right" aria-hidden="true" />
            <span className="eyebrow">OUR NEXT DATE</span>
            {liveDate.items.length ? (
              <div className="home-date-main">
                <DateLeaf empty={false} label={dayLabel(liveDate.startDate)} />
                <div className="home-date-copy">
                  <h3>{liveDate.title || "우리가 고른 데이트"}</h3>
                  <p>{liveDate.startDate ? formatKoDate(liveDate.startDate) : `${liveDate.items[0]?.placeName}에서 시작`}</p>
                  {dateStops ? <p className="home-date-stops">{dateStops}</p> : null}
                  <span className="text-link">데이트 열기 →</span>
                </div>
              </div>
            ) : (
              <div className="home-date-main">
                <DateLeaf empty label="?" />
                <div className="home-date-copy">
                  <h3>데이트 일정이 없어요</h3>
                  <p>어디로 갈지만 말해 주면 하루 코스를 만들어 드려요.</p>
                  <span className="text-link">데이트 만들기 →</span>
                </div>
              </div>
            )}
          </Link>
          <Link className="home-note paper-card" href="/places">
            <span className="note-pencil" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M14.2 4.4 19.6 9.8 8.7 20.7 3.6 21.4 4.3 16.3Z" />
                <path d="m16.1 6.3 1.6 1.6" />
              </svg>
            </span>
            <div>
              <span className="eyebrow">A NOTE FOR US</span>
              <h3>이번엔 둘 다 좋아할 장소를 찾아볼까요?</h3>
              <span className="text-link">장소 찾기 →</span>
            </div>
            <span className="note-heart" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M12 20s-7.2-4.4-7.2-9.2A4.1 4.1 0 0 1 12 8.2a4.1 4.1 0 0 1 7.2 2.6C19.2 15.6 12 20 12 20Z" />
              </svg>
            </span>
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
        <div className="home-index-strip">
          {shownPlaces.map((place, index) => (
            <PlaceIndexCard
              key={place.id}
              place={place}
              href={`/places?selected=${place.id}`}
              note={shared.length ? "둘 다 가고 싶어요" : "내가 저장한 장소"}
              index={index}
            />
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
            <div className="home-index-strip">
              {partnerOnly.map((place, index) => (
                <PlaceIndexCard
                  key={`partner-${place.id}`}
                  place={place}
                  href={`/places?selected=${place.id}`}
                  note={`${partnerName}의 저장 장소`}
                  index={index}
                />
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
              <h2>가장 가까운 장면</h2>
            </div>
            <Link className="quiet-link" href="/memories">{memory ? "열어보기 →" : "남기러 가기 →"}</Link>
          </div>
          {memory && cover ? (
            <Link className="memory-postcard" href="/memories">
              <span className="memory-postcard-frame">
                <span className="memory-postcard-media">
                  {cover.kind === "image" ? <img src={cover.src} alt="" /> : (
                    <span className="memory-letter">
                      <b>{memory.happenedOn ? formatKoShort(memory.happenedOn) : "our day"}</b>
                      <small>{memory.locationLabel || "우리가 아는 장면"}</small>
                    </span>
                  )}
                </span>
              </span>
              <span className="memory-postcard-copy">
                <b>{memory.title}</b>
                <em>{memory.description || "우리가 아는 그날의 장면."}</em>
                <small>{memory.happenedOn ? formatKoDate(memory.happenedOn) : ""}{memory.locationLabel ? ` · ${memory.locationLabel}` : ""}</small>
              </span>
            </Link>
          ) : (
            <p className="form-hint">다녀온 날을 짧게 적어두면, 홈에서 다시 만나요.</p>
          )}
        </section>
        <section className="activity-preview paper-card">
          <div className="section-heading compact">
            <div>
              <span className="eyebrow">RECENT ACTIVITY</span>
              <h2>우리의 최근 변화</h2>
            </div>
          </div>
          <RecentActivityPreview />
        </section>
      </div>
    </>
  );
}

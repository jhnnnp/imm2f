"use client";

import { AppLink } from "@/components/layout/AppLink";
import { ExpandableText } from "@/components/shared/ExpandableText";
import type { TripDayPlan } from "@/features/date/tripDayPlans";
import { tripDateRange } from "@/features/trip/tripDates";
import { formatKoShort } from "@/lib/dates";
import styles from "./DateTripPlans.module.css";

/** Show the original journey's places without turning them into Date edits. */
export function DateTripPlans({ days, selectedDate }: { days: TripDayPlan[]; selectedDate: string }) {
  if (!days.length) return null;
  return (
    <section className={styles.section} aria-label={`${formatKoShort(selectedDate)} 여행 일정`}>
      <div className={styles.heading}>
        <div><span className="eyebrow">A DAY OF OUR TRIP</span><h2>이날의 여행</h2></div>
        <p>여행에 담아 둔 장소와 오늘의 흐름을 함께 볼 수 있어요.</p>
      </div>
      <div className={styles.journeys}>
        {days.map(day => (
          <article key={day.id} className={styles.card}>
            <div className={styles.cardHead}>
              <div className={styles.identity}>
                <div className={styles.badges}><b>DAY {day.dayIndex + 1}</b><span>{day.recorded ? "여행기록" : "예정된 여행"}</span></div>
                <h3>{day.title || "우리의 여행"}</h3>
                <p><span>{tripDateRange(day.startDate, day.dayCount)}</span><span>{day.dayCount}일 중 {day.dayIndex + 1}일째</span><span>{day.items.length}곳</span></p>
              </div>
              <AppLink href={day.href} prefetchMode="hover" className={styles.openLink} aria-label={`${day.title || "우리의 여행"} DAY ${day.dayIndex + 1} ${day.recorded ? "여행기록" : "여행"} 열기`}>{day.recorded ? "여행기록 열기" : "여행 열기"}<span aria-hidden="true">↗</span></AppLink>
            </div>
            {day.items.length ? (
              <ol className={styles.places} aria-label={`DAY ${day.dayIndex + 1} 장소 순서`}>
                {day.items.map((item, index) => (
                  <li key={item.id}>
                    <span className={styles.number} aria-hidden="true">{index + 1}</span>
                    <div className={styles.placeBody}>
                      {item.category && <div className={styles.placeMeta}><span>{item.category}</span></div>}
                      <h4>{item.placeName}</h4>
                      {item.memo && <ExpandableText className={styles.memo} text={item.memo} lines={4} label={`${item.placeName} 설명`} />}
                    </div>
                  </li>
                ))}
              </ol>
            ) : <div className={styles.emptyDay}><b>여행의 {day.dayIndex + 1}번째 날이에요.</b><p>이날의 장소는 아직 정하지 않았어요. 여행을 열어 하루를 채워 보세요.</p></div>}
          </article>
        ))}
      </div>
    </section>
  );
}

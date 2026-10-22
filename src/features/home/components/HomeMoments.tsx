import { AppLink as Link } from "@/components/layout/AppLink";
import type { CoupleNote } from "@/features/lists/types";
import { formatKoDate, formatKoShort } from "@/lib/dates";
import type { UpcomingKeyDate } from "../homeMoments";
import styles from "./HomeMoments.module.css";

function Countdown({ days }: { days: number }) {
  return <span className={styles.countdown}>{days === 0 ? "오늘이에요" : `D−${days}`}</span>;
}

export function UpcomingDaysCard({ events }: { events: UpcomingKeyDate[] }) {
  const [next, ...following] = events;
  if (!next) return null;
  const [year, month, day] = next.date.split("-").map(Number);

  return (
    <section className={`${styles.card} ${styles.dates}`} aria-labelledby="home-important-days">
      <header className={styles.heading}>
        <div><span className={styles.eyebrow}>A LITTLE REMINDER</span><h2 id="home-important-days">다가오는 기념일</h2></div>
        <span className={styles.cornerMark} aria-hidden="true">♡</span>
      </header>
      <div className={styles.dayFeature}>
        <time className={styles.calendarLeaf} dateTime={next.date} aria-label={formatKoDate(next.date)}>
          <span>{month}월</span><b>{day}</b><small>{year}</small>
        </time>
        <div className={styles.dayCopy}>
          <Countdown days={next.daysUntil} />
          <h3>{next.title}</h3>
          <p>{next.kind === "birthday" ? "좋아하는 마음을 전할 날이 가까워져요." : "함께 쌓아 온 날들을, 한 번 더 기념해요."}</p>
        </div>
      </div>
      {following.length > 0 && <ul className={styles.upcomingList} aria-label="그다음 기념일">
        {following.map(event => <li key={event.id}><time dateTime={event.date}>{event.date.slice(0, 4) !== next.date.slice(0, 4) && <small>{event.date.slice(0, 4)}년</small>}{formatKoShort(event.date)}</time><span>{event.title}</span><Countdown days={event.daysUntil} /></li>)}
      </ul>}
      <footer className={styles.footer}>
        <Link className={styles.primary} href={`/date?day=${next.date}`}>이날의 데이트 준비 <span aria-hidden="true">↗</span></Link>
        <Link className={styles.quiet} href="/gifts">선물 아이디어 <span aria-hidden="true">→</span></Link>
      </footer>
    </section>
  );
}

export function BucketWishCard({ wish, completed = 0 }: { wish: CoupleNote | null; completed?: number }) {
  return (
    <section className={`${styles.card} ${styles.wishes}`} aria-labelledby="home-next-wish">
      <header className={styles.heading}>
        <div><span className={styles.eyebrow}>SOMEDAY, TOGETHER</span><h2 id="home-next-wish">언젠가를, 이번에</h2></div>
        <span className={styles.cornerMark} aria-hidden="true">✧</span>
      </header>
      <div className={styles.wishPaper}>
        <div className={styles.wishMeta}><span>{wish ? wish.status === "planning" ? "함께 계획 중" : "우리의 버킷리스트에서" : completed ? `함께 이룬 바람 ${completed}개` : "우리의 첫 번째 바람"}</span><span aria-hidden="true">01</span></div>
        <h3>{wish?.title || (completed ? "다음엔, 무엇을 함께할까요?" : "둘이 꼭 해보고 싶은 일")}</h3>
        <p>{wish?.detail || (wish ? "남겨 둔 바람 하나, 다음 약속으로 이어 볼까요?" : "작은 바람도 좋아요. 언젠가 함께하고 싶은 일을 한 줄 남겨요.")}</p>
        {wish?.extra && <span className={styles.wishWhen}>{wish.extra}</span>}
        <span className={styles.signature} aria-hidden="true">for us, someday.</span>
      </div>
      <footer className={styles.footer}>
        <Link className={styles.primary} href={wish ? `/bucket#bucket-note-${encodeURIComponent(wish.id)}` : "/bucket"}>{wish ? "이 바람 이어가기" : completed ? "새 바람 남기기" : "첫 바람 남기기"}<span aria-hidden="true">↗</span></Link>
        {wish && <Link className={styles.quiet} href="/bucket">모든 바람 보기 <span aria-hidden="true">→</span></Link>}
      </footer>
    </section>
  );
}

export function MomentLoading({ kind }: { kind: "dates" | "wish" }) {
  return <section className={`${styles.card} ${styles.loading}`} aria-busy="true" aria-label={kind === "dates" ? "기념일 불러오는 중" : "버킷리스트 불러오는 중"}><span className={styles.eyebrow}>{kind === "dates" ? "A LITTLE REMINDER" : "SOMEDAY, TOGETHER"}</span><h2>{kind === "dates" ? "다가오는 기념일" : "언젠가를, 이번에"}</h2><div /><div /></section>;
}

export function MomentUnavailable({ kind }: { kind: "dates" | "wish" }) {
  return <section className={styles.card}><span className={styles.eyebrow}>{kind === "dates" ? "A LITTLE REMINDER" : "SOMEDAY, TOGETHER"}</span><h2>{kind === "dates" ? "다가오는 기념일" : "언젠가를, 이번에"}</h2><p className={styles.unavailable}>지금은 불러오지 못했어요. 잠시 후 다시 확인해 주세요.</p><Link className={styles.quiet} href={kind === "dates" ? "/insights#our-dates" : "/bucket"}>{kind === "dates" ? "우리의 날짜 확인" : "버킷리스트 열기"} →</Link></section>;
}

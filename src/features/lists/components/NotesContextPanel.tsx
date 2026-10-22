import Link from "next/link";
import { NOTE_STATUS, type CoupleNote, type NoteKind } from "../types";
import styles from "./NotesContextPanel.module.css";

const PANEL_COPY = {
  vault: {
    eyebrow: "QUICK ACCESS",
    title: "필요할 때 바로",
    quote: "필요한 예약과 정보를 한곳에 모아 두세요.",
    tipTitle: "이렇게 보관해 보세요",
    tips: ["예약명은 장소와 날짜를 함께 적기", "링크나 확인 번호는 별도 필드에 담기", "사용한 항목은 상태를 바꿔 정리하기"],
    nextHref: "/trip",
    nextLabel: "여행 계획으로 이동",
  },
  gift: {
    eyebrow: "GIFT JOURNEY",
    title: "마음을 전하는 과정",
    quote: "떠오른 아이디어부터 전달한 순간까지 차근차근 기록해요.",
    tipTitle: "선물 플랜 루틴",
    tips: ["떠오른 아이디어를 가볍게 기록하기", "준비를 시작하면 상태 바꾸기", "전한 뒤 작은 반응까지 메모하기"],
    nextHref: "/calendar",
    nextLabel: "기념일 확인하기",
  },
  bucket: {
    eyebrow: "OUR NEXT SCENE",
    title: "다음 장면을 향해",
    quote: "함께 하고 싶은 일을 적고, 이룬 순간을 추억으로 남겨요.",
    tipTitle: "꿈을 현실로 만드는 법",
    tips: ["작고 구체적인 문장으로 적기", "마음이 정해지면 준비 중으로 바꾸기", "달성한 날은 추억으로 이어 남기기"],
    nextHref: "/memories",
    nextLabel: "추억으로 남기기",
  },
} satisfies Record<NoteKind, { eyebrow: string; title: string; quote: string; tipTitle: string; tips: string[]; nextHref: string; nextLabel: string }>;

export function NotesContextPanel({ kind, notes }: { kind: NoteKind; notes: CoupleNote[] }) {
  const copy = PANEL_COPY[kind];
  const statuses = NOTE_STATUS[kind];
  const latest = notes.reduce<CoupleNote | undefined>((recent, note) => {
    const timestamp = Date.parse(note.createdAt);
    const previous = recent ? Date.parse(recent.createdAt) : -Infinity;
    return !recent || Number.isFinite(timestamp) && (!Number.isFinite(previous) || timestamp > previous) ? note : recent;
  }, undefined);

  return (
    <div className={`notes-context notes-context-${kind} ${styles.panel}`}>
      <header className={styles.header}>
        <span>{copy.eyebrow}</span><h2>{copy.title}</h2>
        <p>{copy.quote}</p>
      </header>
      <section className={styles.section} aria-label="상태별 기록 수">
        <h3>한눈에 보기 <span>총 {notes.length}개</span></h3>
        <div className={styles.statuses}>
          {statuses.map(status => (
            <div key={status.id}><strong>{notes.filter(note => note.status === status.id).length}</strong><span>{status.label}</span></div>
          ))}
        </div>
      </section>
      {latest && (
        <section className={`${styles.section} ${styles.latest}`}>
          <h3>최근 기록</h3><b>{latest.title}</b><small>가장 최근에 남긴 기록이에요</small>
        </section>
      )}
      <details className={`${styles.section} ${styles.guide}`}>
        <summary>{copy.tipTitle}<span aria-hidden="true">⌄</span></summary>
        <ol>{copy.tips.map((tip, index) => <li key={tip}><b>{index + 1}</b><p>{tip}</p></li>)}</ol>
      </details>
      <Link className={styles.next} href={copy.nextHref}>{copy.nextLabel}<span aria-hidden="true">→</span></Link>
    </div>
  );
}

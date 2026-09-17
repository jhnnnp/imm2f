import Link from "next/link";
import { NOTE_STATUS, type CoupleNote, type NoteKind } from "../types";

const PANEL_COPY = {
  vault: {
    eyebrow: "QUICK ACCESS",
    title: "필요할 때 바로",
    quote: "흩어진 정보가 제자리를 찾으면, 둘의 다음 순간은 더 가벼워져요.",
    tipTitle: "이렇게 보관해 보세요",
    tips: ["예약명은 장소와 날짜를 함께 적기", "링크나 확인 번호는 별도 필드에 담기", "사용한 항목은 상태를 바꿔 정리하기"],
    nextHref: "/trip",
    nextLabel: "여행 계획으로 이동",
  },
  gift: {
    eyebrow: "GIFT JOURNEY",
    title: "마음을 전하는 과정",
    quote: "좋은 선물은 물건보다, 상대를 오래 생각한 시간에 가까워요.",
    tipTitle: "선물 플랜 루틴",
    tips: ["떠오른 아이디어를 가볍게 기록하기", "준비를 시작하면 상태 바꾸기", "전한 뒤 작은 반응까지 메모하기"],
    nextHref: "/calendar",
    nextLabel: "기념일 확인하기",
  },
  bucket: {
    eyebrow: "OUR NEXT SCENE",
    title: "다음 장면을 향해",
    quote: "함께 꿈꾸던 일을 해낸 날, 버킷은 둘의 추억이 돼요.",
    tipTitle: "꿈을 현실로 만드는 법",
    tips: ["작고 구체적인 문장으로 적기", "마음이 정해지면 준비 중으로 바꾸기", "달성한 날은 추억으로 이어 남기기"],
    nextHref: "/memories",
    nextLabel: "추억으로 남기기",
  },
} satisfies Record<NoteKind, { eyebrow: string; title: string; quote: string; tipTitle: string; tips: string[]; nextHref: string; nextLabel: string }>;

export function NotesContextPanel({ kind, notes }: { kind: NoteKind; notes: CoupleNote[] }) {
  const copy = PANEL_COPY[kind];
  const statuses = NOTE_STATUS[kind];
  const latest = notes[0];

  return (
    <div className={`notes-context notes-context-${kind}`}>
      <div className="panel-heading">
        <div><span className="eyebrow">{copy.eyebrow}</span><h2>{copy.title}</h2></div>
      </div>
      <blockquote>{copy.quote}</blockquote>
      <section className="notes-context-status">
        <span>STATUS</span>
        <div>
          {statuses.map(status => (
            <p key={status.id}><i /><b>{status.label}</b><strong>{notes.filter(note => note.status === status.id).length}</strong></p>
          ))}
        </div>
      </section>
      {latest && (
        <section className="notes-context-latest">
          <span>LATEST</span><b>{latest.title}</b><small>가장 최근에 남긴 기록</small>
        </section>
      )}
      <section className="notes-context-tips">
        <span>GUIDE</span><h3>{copy.tipTitle}</h3>
        <ol>{copy.tips.map((tip, index) => <li key={tip}><b>{index + 1}</b><p>{tip}</p></li>)}</ol>
      </section>
      <Link href={copy.nextHref}>{copy.nextLabel}<span>→</span></Link>
    </div>
  );
}

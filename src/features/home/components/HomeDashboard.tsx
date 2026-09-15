import Link from "next/link";
import { PLACES } from "@/features/places/data/places";

export function HomeDashboard() {
  return <>
    <div className="page-intro home-intro"><div><span className="eyebrow">WEDNESDAY · 맑음 24°</span><h1>오늘도,<br />우리의 기록은 계속되고 있어요.</h1></div><div className="hand-note">next page,<br />with you ♡</div></div>
    <div className="home-layout">
      <Link className="next-journey visual-card" href="/trip"><img src="/assets/gunsan-evening.png" alt="군산 바닷가에서 바라본 저녁 풍경" /><div className="image-shade" /><div className="journey-copy"><div><span className="light-label">NEXT JOURNEY</span><b className="d-day">D−2</b></div><h2>군산, 느리게 걷는 2박 3일</h2><p>9월 18일 — 20일 · 둘이 저장한 장소 8</p><div className="plan-progress"><i style={{ width: "72%" }} /></div><small>계획이 72% 채워졌어요</small></div></Link>
      <div className="home-side-stack">
        <Link className="next-date paper-card" href="/date"><span className="eyebrow">NEXT DATE · D−5</span><div><div className="date-leaf"><b>21</b><small>SEP</small></div><div><h3>서촌 필름 산책</h3><p>사진 한 롤, 커피 두 잔</p><strong>예상 ₩82,000</strong></div></div></Link>
        <Link className="ai-nudge paper-card" href="/places"><div className="spark">✦</div><div><span className="eyebrow">A NOTE FOR US</span><h3>이번 주말, 둘 다 좋아할 만한 데이트를 찾아볼까요?</h3><span className="text-link">장소 추천 받기 →</span></div></Link>
      </div>
    </div>
    <div className="section-heading"><div><span className="eyebrow">BOTH OF US</span><h2>둘 다 가고 싶은 곳</h2></div><Link className="quiet-link" href="/places">모두 보기 →</Link></div>
    <div className="place-strip">{PLACES.slice(0,3).map(place => <Link className={`mini-place tone-${place.visualTone}`} href={`/places?selected=${place.id}`} key={place.id}>{place.image ? <img src={place.image} alt={place.name} /> : <div className="abstract-photo">{place.categoryLabel}<br />memory</div>}<div><span>{place.categoryLabel.toUpperCase()} · 군산</span><h3>{place.name}</h3><p><b>♥</b> 둘 다 가고 싶어요</p></div></Link>)}</div>
    <div className="home-bottom-grid">
      <section className="recent-memory paper-card"><div className="section-heading compact"><div><span className="eyebrow">RECENT MEMORY</span><h2>성수에서 보낸 토요일</h2></div><Link className="quiet-link" href="/memories">열어보기 →</Link></div><div className="memory-row"><img src="/assets/gunsan-evening.png" alt="함께 본 저녁 풍경" /><div><p>“계획 없이 걷다가,<br />오래 기억할 저녁을 만났어요.”</p><small>2026. 09. 12 · 성수</small></div></div></section>
      <section className="activity-preview paper-card"><div className="section-heading compact"><div><span className="eyebrow">RECENT ACTIVITY</span><h2>둘의 최근 변화</h2></div></div><div className="activity-line"><span className="avatar partner">상</span><p><b>상민이 군산 여행을 수정했어요.</b><small>카페 라파르 · 15:00 → 16:30</small></p><time>3시간 전</time></div><div className="activity-line"><span className="avatar you">지</span><p><b>지은이 새로운 장소를 저장했어요.</b><small>월명동 책방</small></p><time>어제</time></div></section>
    </div>
  </>;
}

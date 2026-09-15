export function ActivityPanel() {
  return <div>
    <div className="panel-heading"><div><span className="eyebrow">TODAY</span><h2>오늘의 이야기</h2></div><button className="icon-button">•••</button></div>
    <div className="activity-feed">
      <article className="activity-item important"><span className="activity-symbol">↗</span><div><b>군산 여행 계획을 수정했어요</b><small>상민 · 3시간 전</small><p>은파호수공원<br /><del>16:40</del> → <strong>17:30</strong></p></div></article>
      <article className="activity-item"><span className="avatar you">지</span><div><b>새 장소를 저장했어요</b><small>지은 · 5시간 전</small><p>“여기 창가 자리, 꼭 같이 앉자.”</p></div></article>
      <article className="activity-item"><span className="activity-symbol blue">▧</span><div><b>지난 제주 사진을 정리했어요</b><small>어제</small><div className="tiny-gallery"><img src="/assets/gunsan-evening.png" alt="" /><img src="/assets/cafe-memory.png" alt="" /><span>+9</span></div></div></article>
    </div>
    <div className="countdown-card"><span>OUR NEXT PAGE</span><strong>군산으로 떠나기까지</strong><b>2</b><small>days to go</small></div>
  </div>;
}

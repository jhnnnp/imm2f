"use client";

import { useState, useTransition } from "react";
import { analyzeCouplePreferences } from "../actions";
import type { PreferenceInsight } from "@/lib/openai/analyzePreferences";

export function InsightsPanel({ initial }: { initial: PreferenceInsight | null }) {
  const [insight, setInsight] = useState<PreferenceInsight | null>(initial);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function refresh() {
    setError("");
    startTransition(async () => {
      const result = await analyzeCouplePreferences();
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setInsight(result);
    });
  }

  return (
    <>
      <div className="page-title-row">
        <div>
          <span className="eyebrow">OUR TASTE</span>
          <h1>우리의 취향</h1>
          <p>쌓인 기록 속에서 둘이 좋아하는 여행의 리듬을 발견해요.</p>
        </div>
        <button className="outline-button" type="button" onClick={refresh} disabled={pending}>
          {pending ? "분석 중..." : "다시 분석하기"}
        </button>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}

      {!insight ? (
        <div className="empty-soft insight-empty">
          <span aria-hidden="true">∿</span>
          <h2>좋아하는 곳에서 우리다움을 찾아요</h2>
          <p>각자 저장한 장소의 유형, 분위기, 지역과 활동을 비교해 보여드려요.</p>
          <div className="insight-empty-flow" aria-label="분석 결과 구성">
            <b>공통 취향</b><i aria-hidden="true">→</i><b>각자의 매력</b><i aria-hidden="true">→</i><b>데이트 아이디어</b>
          </div>
          <button className="primary-button" type="button" onClick={refresh} disabled={pending}>
            {pending ? "분석 중..." : "지금 분석하기"}
          </button>
        </div>
      ) : (
        <div className="taste-report">
          <section className="taste-overview">
            <article className="paper-card taste-score-card">
              <div className="taste-score" style={{ "--match": `${insight.matchScore * 3.6}deg` } as React.CSSProperties}>
                <div><strong>{insight.matchScore}</strong><small>%</small></div>
              </div>
              <div>
                <span className="eyebrow">OUR MATCH</span>
                <h2>우리 취향의 겹치는 지점</h2>
                <p>{insight.summary}</p>
                <small>{insight.note}</small>
              </div>
            </article>
            <article className="paper-card common-taste-card">
              <span className="eyebrow">COMMON TASTE</span>
              <h2>둘 다 좋아해요</h2>
              <div className="taste-tags">
                {insight.commonTastes.map(item => (
                  <span key={item.label}><b>{item.label}</b><small>{item.score}</small></span>
                ))}
              </div>
            </article>
          </section>

          <section className="taste-section">
            <div className="taste-section-head"><span>01</span><div><small>각자의 취향</small><h2>비슷하지만, 좋아하는 포인트는 달라요</h2></div></div>
            <div className="taste-people-grid">
              <article className="paper-card taste-person is-you">
                <span className="person-mark">나</span><small>MY TASTE</small><h3>내가 끌리는 곳</h3>
                <ul>{insight.youHighlights.map(item => <li key={`you-${item}`}>{item}</li>)}</ul>
              </article>
              <div className="taste-plus" aria-hidden="true">+</div>
              <article className="paper-card taste-person is-partner">
                <span className="person-mark">P</span><small>PARTNER TASTE</small><h3>파트너가 끌리는 곳</h3>
                <ul>{insight.partnerHighlights.map(item => <li key={`partner-${item}`}>{item}</li>)}</ul>
              </article>
            </div>
          </section>

          <section className="taste-section">
            <div className="taste-section-head"><span>02</span><div><small>서로 다른 매력</small><h2>차이를 알면 장소 고르기가 쉬워져요</h2></div></div>
            <div className="difference-list">
              {insight.differences.map((item, index) => (
                <article className="paper-card difference-card" key={`${item.you}-${index}`}>
                  <div><small>나</small><p>{item.you}</p></div>
                  <span aria-hidden="true">↔</span>
                  <div><small>파트너</small><p>{item.partner}</p></div>
                  <aside><b>함께 즐기는 방법</b><p>{item.bridge}</p></aside>
                </article>
              ))}
            </div>
          </section>

          <section className="taste-section">
            <div className="taste-section-head"><span>03</span><div><small>다음 데이트</small><h2>두 취향이 만나는 곳을 찾아보세요</h2></div></div>
            <div className="recommendation-grid">
              {insight.recommendations.map((item, index) => (
                <article className="paper-card recommendation-card" key={`${item.title}-${index}`}>
                  <span>{String(index + 1).padStart(2, "0")}</span><h3>{item.title}</h3><p>{item.description}</p><small>{item.reason}</small>
                </article>
              ))}
            </div>
          </section>
        </div>
      )}
    </>
  );
}

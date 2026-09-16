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
        <div className="empty-soft">
          <span>∿</span>
          <h1>둘의 취향을 분석해 볼까요?</h1>
          <p>저장한 장소를 바탕으로 공통 취향과 서로 다른 매력을 정리해 드려요.</p>
          <button className="primary-button" type="button" onClick={refresh} disabled={pending}>
            {pending ? "분석 중..." : "지금 분석하기"}
          </button>
        </div>
      ) : (
        <div className="insight-grid">
          <article className="paper-card insight-quote">
            <span>AI NOTE</span>
            <p>{insight.summary}</p>
            <small>{insight.note}</small>
          </article>
          <article className="paper-card">
            <span className="eyebrow">COMMON TASTE</span>
            <div className="taste-bars">
              {insight.commonTastes.map(item => (
                <label key={item.label}>
                  {item.label}
                  <i style={{ "--score": `${item.score}%` } as React.CSSProperties} />
                  <b>{item.score}</b>
                </label>
              ))}
            </div>
          </article>
          <article className="paper-card insight-side">
            <span className="eyebrow">YOU</span>
            <ul>
              {insight.youHighlights.map(item => <li key={`you-${item}`}>{item}</li>)}
            </ul>
          </article>
          <article className="paper-card insight-side">
            <span className="eyebrow">PARTNER</span>
            <ul>
              {insight.partnerHighlights.map(item => <li key={`partner-${item}`}>{item}</li>)}
            </ul>
          </article>
        </div>
      )}
    </>
  );
}

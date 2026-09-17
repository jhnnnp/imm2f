"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { proposePlanEdits, recommendDatePlan } from "../actions";
import type { AIPlannerReply, AIPlannerState, PlanChange, PlanItem, PlanKind } from "@/features/planning/types/plan";
import type { Place } from "@/features/places/types/place";
import { PlanMap } from "@/features/trip/components/PlanMap";

const EDIT_PROMPT = "일정이 조금 빡센 것 같아. 한곳 빼고 남는 곳은 더 여유롭게 해줘.";
const GENERATE_PLACEHOLDER = "예: 왕십리에서 조용하게 데이트하고 싶어";
const ACTIVITY_OPTIONS = ["카페", "맛있는 식사", "산책", "전시", "실내 놀거리", "야경"];
const AREA_OPTIONS = ["성수", "서울숲", "건대입구", "왕십리", "한남", "잠실"];

function formatDistance(meters: number | null) {
  if (meters == null) return "거리 정보 없음";
  if (meters < 1000) return `앞 장소에서 직선거리 ${meters}m`;
  return `앞 장소에서 직선거리 ${(meters / 1000).toFixed(1)}km`;
}

type Mode = "edit" | "generate";
type ChoicePrompt = { options: string[]; multiple: boolean; kind: "activity" | "area" | "ai" };

export function AIPlanEditor({
  kind,
  items,
  onApply,
  onReplace,
  places,
}: {
  kind: PlanKind;
  items: PlanItem[];
  onApply: (changes: PlanChange[]) => void;
  onReplace: (next: PlanItem[]) => void;
  places?: Place[];
}) {
  const [mode, setMode] = useState<Mode>(kind === "date" ? "generate" : items.length ? "edit" : "generate");
  const [editPrompt, setEditPrompt] = useState(() => items.length <= 1 ? "이 장소에서 여유롭게 머물 수 있도록 체류 시간을 조정해줘." : EDIT_PROMPT);
  const [generatePrompt, setGeneratePrompt] = useState("");
  const [phase, setPhase] = useState<"idle" | "loading" | "preview">("idle");
  const [changes, setChanges] = useState<PlanChange[]>([]);
  const [summary, setSummary] = useState("");
  const [selected, setSelected] = useState<boolean[]>([]);
  const [recommendation, setRecommendation] = useState<AIPlannerReply | null>(null);
  const [plannerState, setPlannerState] = useState<AIPlannerState | undefined>();
  const [conversation, setConversation] = useState<Array<{ role: "user" | "assistant"; text: string }>>([]);
  const [choicePrompt, setChoicePrompt] = useState<ChoicePrompt | null>(() => kind === "date" ? { options: ACTIVITY_OPTIONS, multiple: true, kind: "activity" } : null);
  const [selectedChoices, setSelectedChoices] = useState<string[]>([]);
  const [onboardingActivities, setOnboardingActivities] = useState<string[]>([]);
  const [error, setError] = useState("");
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const chatLogRef = useRef<HTMLDivElement>(null);
  const keepChatPinnedRef = useRef(true);

  useEffect(() => {
    const chatLog = chatLogRef.current;
    if (!chatLog || !keepChatPinnedRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      chatLog.scrollTo({ top: chatLog.scrollHeight, behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [conversation]);

  const chosen = useMemo(
    () => changes.filter((_, index) => selected[index]),
    [changes, selected],
  );
  const routeSummary = useMemo(() => {
    if (!recommendation) return null;
    return {
      distance: recommendation.recommendations.reduce((sum, place) => sum + (place.distanceFromPreviousMeters ?? 0), 0),
    };
  }, [recommendation]);

  function switchMode(next: Mode) {
    setMode(next);
    setPhase("idle");
    setError("");
    setChanges([]);
    setRecommendation(null);
    setPlannerState(undefined);
    setConversation([]);
    setChoicePrompt(next === "generate" ? { options: ACTIVITY_OPTIONS, multiple: true, kind: "activity" } : null);
    setSelectedChoices([]);
    setOnboardingActivities([]);
  }

  async function runEdit() {
    if (!items.length) {
      setError("수정할 일정이 없어요. 먼저 일정을 만들거나 장소를 담아 주세요.");
      return;
    }
    setError("");
    setPhase("loading");
    const result = await proposePlanEdits({ kind, prompt: editPrompt, items });
    if ("error" in result) {
      setError(result.error);
      setPhase("idle");
      return;
    }
    if (!result.changes.length) {
      setError(result.summary || "바꿀 항목을 찾지 못했어요.");
      setPhase("idle");
      return;
    }
    setChanges(result.changes);
    setSummary(result.summary);
    setSelected(result.changes.map(() => true));
    setPhase("preview");
  }

  async function runGenerate(override?: string, displayText?: string) {
    const rawRequest = (override ?? generatePrompt).trim();
    const request = choicePrompt?.kind === "area" && onboardingActivities.length && !override
      ? `${onboardingActivities.join(", ")} 데이트를 하고 싶어. 가고 싶은 곳은 ${rawRequest}`
      : rawRequest;
    if (!request) {
      setError("원하는 데이트를 말해 주세요.");
      return;
    }
    setError("");
    setPhase("loading");
    setChoicePrompt(null);
    setSelectedChoices([]);
    setConversation(current => [...current, { role: "user", text: displayText ?? rawRequest }]);
    const contextPrompt = recommendation
      ? `${conversation.filter(message => message.role === "user").map(message => message.text).join("\n")}\n이전 추천: ${recommendation.recommendations.map(place => place.name).join(", ")}\n추가 요청: ${request}`
      : request;
    const result = await recommendDatePlan({
      prompt: contextPrompt,
      latestPrompt: request,
      previousPlaceNames: recommendation?.recommendations.map(place => place.name),
      previousState: plannerState,
    });
    if ("error" in result) {
      const safeError = /^false\b/i.test(result.error)
        ? "조건에 맞는 장소를 충분히 찾지 못했어요. 지역이나 요청을 조금 바꿔 주세요."
        : result.error;
      setError(safeError);
      setPhase("idle");
      return;
    }
    setPlannerState(result.state);
    setConversation(current => [...current, { role: "assistant", text: result.message }]);
    setGeneratePrompt("");
    if (composerRef.current) composerRef.current.style.height = "38px";
    if (result.status === "clarification") {
      setChoicePrompt({ options: result.options, multiple: result.multiple, kind: "ai" });
      setPhase(recommendation ? "preview" : "idle");
      return;
    }
    setRecommendation(result);
    setPhase("preview");
  }

  function submitChoices() {
    if (!choicePrompt || !selectedChoices.length) return;
    if (choicePrompt.kind === "activity") {
      setOnboardingActivities(selectedChoices);
      setConversation(current => [
        ...current,
        { role: "user", text: `${selectedChoices.join(", ")} 하고 싶어` },
        { role: "assistant", text: "좋아요. 어느 동네에서 시작하거나 들르고 싶나요? 여러 곳을 골라도 돼요." },
      ]);
      setChoicePrompt({ options: AREA_OPTIONS, multiple: true, kind: "area" });
      setSelectedChoices([]);
      return;
    }
    if (choicePrompt.kind === "area") {
      const request = `${onboardingActivities.join(", ")} 데이트를 하고 싶어. 가고 싶은 곳은 ${selectedChoices.join(", ")}`;
      void runGenerate(request, `${selectedChoices.join(", ")} 쪽이 좋아`);
      return;
    }
    void runGenerate(`${selectedChoices.join(", ")} ${choicePrompt.multiple ? "코스를 원해" : "으로 할게"}`);
  }

  return (
    <div className="ai-editor">
      <header className="ai-editor-head">
        <div className="ai-brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M12 2l1.35 5.1L18 9l-4.65 1.9L12 16l-1.35-5.1L6 9l4.65-1.9L12 2Z"/><path d="M19 15l.7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7L19 15Z"/></svg>
        </div>
        <div>
          <span className="eyebrow">ONLY US AI</span>
          <h2>{mode === "generate" ? "데이트 플래너" : "일정 다듬기"}</h2>
          <p>{mode === "generate" ? "대화로 완성하는 우리만의 하루" : "말 한마디로 더 여유로운 일정"}</p>
        </div>
        <span className="ai-online"><i /> online</span>
      </header>
      {kind === "trip" && (
        <div className="ai-mode-tabs" role="tablist" aria-label="AI 모드">
          <button type="button" className={mode === "generate" ? "is-active" : ""} onClick={() => switchMode("generate")}>AI 추천</button>
          <button type="button" className={mode === "edit" ? "is-active" : ""} onClick={() => switchMode("edit")}>일정 수정</button>
        </div>
      )}

      {mode === "edit" ? (
        <>
          <label className="ai-prompt-field">
            <span>요청</span>
            <textarea
              value={editPrompt}
              onChange={event => setEditPrompt(event.target.value)}
              rows={4}
              placeholder={EDIT_PROMPT}
              disabled={phase === "loading"}
            />
          </label>
          <button className="primary-button full" type="button" onClick={() => void runEdit()} disabled={phase === "loading"}>
            {phase === "loading" ? "제안 만드는 중..." : "변경안 만들기"}
          </button>
        </>
      ) : (
        <>
          <div
            className="ai-chat-log"
            aria-live="polite"
            ref={chatLogRef}
            onScroll={event => {
              const element = event.currentTarget;
              keepChatPinnedRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 36;
            }}
          >
              <p className="is-assistant">오늘 어떤 데이트를 하고 싶나요?<br />하고 싶은 걸 먼저 고르면 어울리는 동선을 같이 만들게요.</p>
              {conversation.map((message, index) => (
                <p key={`${message.role}-${index}`} className={message.role === "user" ? "is-user" : "is-assistant"}>{message.text}</p>
              ))}
          </div>
          {choicePrompt && (
            <div className="ai-choice-panel" aria-label="AI 추천 선택지">
              <span>{choicePrompt.multiple ? "여러 개 선택할 수 있어요" : "하나를 선택해 주세요"}</span>
              <div>
                {choicePrompt.options.map(option => {
                  const active = selectedChoices.includes(option);
                  return (
                    <button
                      type="button"
                      key={option}
                      className={active ? "is-selected" : ""}
                      aria-pressed={active}
                      onClick={() => setSelectedChoices(current => choicePrompt.multiple
                        ? current.includes(option) ? current.filter(item => item !== option) : [...current, option]
                        : [option])}
                    >
                      <i>{active ? "✓" : "+"}</i>{option}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                className="ai-choice-submit"
                disabled={!selectedChoices.length || phase === "loading"}
                onClick={submitChoices}
              >{choicePrompt.kind === "activity" ? "다음" : "선택 완료"} <b>→</b></button>
            </div>
          )}
          <div className="ai-chat-composer">
            <textarea
              ref={composerRef}
              value={generatePrompt}
              onChange={event => {
                setGeneratePrompt(event.target.value);
                setError("");
                event.currentTarget.style.height = "auto";
                event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 96)}px`;
              }}
              onKeyDown={event => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  if (phase !== "loading") void runGenerate();
                }
              }}
              rows={1}
              aria-label="AI 플래너에게 메시지"
              placeholder={choicePrompt?.kind === "activity"
                ? "원하는 데이트를 직접 말해도 좋아요"
                : choicePrompt?.kind === "area"
                  ? "목록에 없는 동네를 직접 입력해 주세요"
                  : recommendation ? "예: 카페는 한 곳만 넣고 산책을 추가해줘" : GENERATE_PLACEHOLDER}
              disabled={phase === "loading"}
            />
            <button type="button" onClick={() => void runGenerate()} disabled={phase === "loading" || !generatePrompt.trim()} aria-label="메시지 보내기">
              {phase === "loading" ? <i className="ai-spinner" /> : <span>↑</span>}
            </button>
            <small>Enter 전송 · Shift + Enter 줄바꿈</small>
            {error && mode === "generate" && (
              <div className="ai-error-tooltip" role="alert">
                <i aria-hidden="true">!</i>
                <span><b>장소를 다시 확인해 주세요</b>{error}</span>
                <button type="button" onClick={() => setError("")} aria-label="안내 닫기">×</button>
              </div>
            )}
          </div>
        </>
      )}

      {error && mode === "edit" && <p className="form-error" role="alert">{error}</p>}

      {phase === "loading" && (
        <div className="ai-progress">
          <div className="ai-search-orbit"><i /><i /><i /></div>
          <div><span>{mode === "generate" ? "둘에게 잘 맞는 장소를 찾는 중" : "일정을 읽고 있어요"}</span><p>{mode === "generate" ? "실제 장소와 가까운 동선을 비교하고 있어요." : "요청에 맞는 조정을 준비하고 있어요."}</p></div>
        </div>
      )}

      {phase === "preview" && mode === "edit" && (
        <div className="ai-proposal">
          <div className="proposal-title">
            <span>AI 변경 제안</span>
            <b>{changes.length}가지</b>
          </div>
          {summary && <p className="proposal-summary-text">{summary}</p>}
          {changes.map((change, index) => (
            <label key={`${change.type}-${change.itemId}-${index}`}>
              <input
                type="checkbox"
                checked={selected[index] ?? false}
                onChange={() => setSelected(current => current.map((value, i) => (i === index ? !value : value)))}
              />
              <span>
                <em>{change.type === "remove" ? "삭제" : "변경"}</em>
                <b>{change.label}</b>
                <small>{change.detail}</small>
              </span>
            </label>
          ))}
          <div className="proposal-summary">
            <span>선택 <b>{chosen.length}/{changes.length}</b></span>
          </div>
          <button className="primary-button full" type="button" disabled={!chosen.length} onClick={() => onApply(chosen)}>
            선택한 {chosen.length}개 적용
          </button>
          <button className="outline-button full" type="button" onClick={() => setPhase("idle")}>다시 요청하기</button>
        </div>
      )}

      {phase === "preview" && mode === "generate" && recommendation && (
        <div className="ai-proposal">
          <div className="ai-plan-overview">
            <div className="ai-plan-overview-copy">
              <span>CURATED FOR TWO</span>
              <h3>{recommendation.condition.region} 데이트 코스</h3>
              <p>{recommendation.recommendations.length}곳을 가까운 순서로 연결했어요.</p>
            </div>
            <div className="ai-plan-stats">
              <span><b>{recommendation.recommendations.length}</b> places</span>
              <span><b>{routeSummary && routeSummary.distance >= 1000 ? `${(routeSummary.distance / 1000).toFixed(1)}km` : `${routeSummary?.distance ?? 0}m`}</b> direct</span>
            </div>
          </div>
          <div className="ai-route-map">
            <PlanMap items={recommendation.items} dayLabel={`${recommendation.condition.region} ROUTE`} />
            <div className="ai-map-legend"><span><i /> 추천 순서</span><b>핀을 따라 코스를 확인해 보세요</b></div>
          </div>
          <div className="proposal-title ai-route-title">
            <span>추천 동선</span>
            <b><i /> {recommendation.source === "openai" ? "AI curated" : "smart route"}</b>
          </div>
          <ol className="ai-recommendation-list">
            {recommendation.recommendations.map((place, index) => (
              <li key={place.id}>
                {index > 0 && <p className="ai-route-distance"><span>↓</span>{formatDistance(place.distanceFromPreviousMeters)}</p>}
                <article>
                  <header><em>{String(index + 1).padStart(2, "0")}</em><div><b>{place.name}</b><small>{place.category} · {place.district}</small></div></header>
                  <ul>{place.reasons.map(reason => <li key={reason}><i>✓</i>{reason}</li>)}</ul>
                  {place.mapUrl && <footer><a href={place.mapUrl} target="_blank" rel="noreferrer">지도에서 보기 <b>↗</b></a></footer>}
                </article>
              </li>
            ))}
          </ol>
          <div className="ai-apply-bar">
            <div><span>이 코스가 마음에 드나요?</span><small>담은 뒤에도 언제든 수정할 수 있어요.</small></div>
            <button type="button" disabled={!recommendation.items.length} onClick={() => onReplace(recommendation.items)}>일정에 담기 <span>→</span></button>
          </div>
        </div>
      )}

      <p className="form-hint ai-disclaimer">
        {mode === "generate"
          ? "이동시간과 비용은 확정하지 않아요. 실제 장소 좌표의 직선거리로 가까운 동선을 우선합니다."
          : "AI는 새 장소를 만들지 않아요. 이미 담긴 일정만 삭제하거나 체류 시간을 조정합니다."}
      </p>
    </div>
  );
}

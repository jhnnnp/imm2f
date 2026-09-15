"use client";

import { useMemo, useState } from "react";
import { generatePlanOptions, proposePlanEdits } from "../actions";
import type { PlanChange, PlanItem, PlanKind, PlanOption } from "@/features/planning/types/plan";

function formatWon(value: number) {
  return Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function budgetAfter(items: PlanItem[], changes: PlanChange[]) {
  const removed = new Set(changes.filter(change => change.type === "remove").map(change => change.itemId));
  return items
    .filter(item => !removed.has(item.id))
    .reduce((sum, item) => sum + item.expectedCost, 0);
}

const EDIT_PROMPT = "일정이 조금 빡센 것 같아. 한곳 빼고 남는 곳은 더 여유롭게 해줘.";
const GENERATE_PROMPT = "조용하고 오래 머무를 수 있게, 이동은 적게.";

type Mode = "edit" | "generate";

export function AIPlanEditor({
  kind,
  items,
  onApply,
  onReplace,
}: {
  kind: PlanKind;
  items: PlanItem[];
  onApply: (changes: PlanChange[]) => void;
  onReplace: (next: PlanItem[]) => void;
}) {
  const [mode, setMode] = useState<Mode>(items.length ? "edit" : "generate");
  const [editPrompt, setEditPrompt] = useState(EDIT_PROMPT);
  const [generatePrompt, setGeneratePrompt] = useState(GENERATE_PROMPT);
  const [phase, setPhase] = useState<"idle" | "loading" | "preview">("idle");
  const [changes, setChanges] = useState<PlanChange[]>([]);
  const [summary, setSummary] = useState("");
  const [selected, setSelected] = useState<boolean[]>([]);
  const [options, setOptions] = useState<PlanOption[]>([]);
  const [optionKey, setOptionKey] = useState<"A" | "B" | "C" | "">("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const beforeBudget = useMemo(() => items.reduce((sum, item) => sum + item.expectedCost, 0), [items]);
  const chosen = useMemo(
    () => changes.filter((_, index) => selected[index]),
    [changes, selected],
  );
  const afterBudget = useMemo(() => budgetAfter(items, chosen), [items, chosen]);
  const activeOption = options.find(option => option.key === optionKey) ?? null;

  function switchMode(next: Mode) {
    setMode(next);
    setPhase("idle");
    setError("");
    setChanges([]);
    setOptions([]);
    setOptionKey("");
    setNote("");
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

  async function runGenerate() {
    setError("");
    setPhase("loading");
    const result = await generatePlanOptions({ kind, prompt: generatePrompt });
    if ("error" in result) {
      setError(result.error);
      setPhase("idle");
      return;
    }
    setOptions(result.options);
    setNote(result.note);
    setOptionKey(result.options[0]?.key ?? "");
    setPhase("preview");
  }

  return (
    <div className="ai-editor">
      <span className="eyebrow">PLAN WITH AI</span>
      <h2>{mode === "generate" ? "일정 3안 만들기" : "일정을 조금 더 여유롭게"}</h2>
      <p className="panel-lead">
        {mode === "generate"
          ? "저장된 장소만으로 A/B/C 안을 만들어요. 고른 뒤에만 일정에 반영됩니다."
          : "자연스럽게 말해 주세요. 적용하기 전에 꼭 먼저 보여드릴게요."}
      </p>
      <div className="ai-mode-tabs" role="tablist" aria-label="AI 모드">
        <button type="button" className={mode === "generate" ? "is-active" : ""} onClick={() => switchMode("generate")}>일정 생성</button>
        <button type="button" className={mode === "edit" ? "is-active" : ""} onClick={() => switchMode("edit")}>자연어 수정</button>
      </div>

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
          <label className="ai-prompt-field">
            <span>특별 요청</span>
            <textarea
              value={generatePrompt}
              onChange={event => setGeneratePrompt(event.target.value)}
              rows={3}
              placeholder={GENERATE_PROMPT}
              disabled={phase === "loading"}
            />
          </label>
          <button className="primary-button full" type="button" onClick={() => void runGenerate()} disabled={phase === "loading"}>
            {phase === "loading" ? "3안 만드는 중..." : "A/B/C 3안 만들기"}
          </button>
        </>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}

      {phase === "loading" && (
        <div className="ai-progress">
          <span>{mode === "generate" ? "여행을 정리하고 있어요." : "일정을 읽고 있어요."}</span>
          <p>✓ 선택 장소 확인</p>
          <p>{mode === "generate" ? "◌ 지역별 묶기" : "◌ 요청에 맞는 조정 찾기"}</p>
          <p>◌ 미리보기 준비</p>
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
            <span>예산 <b>₩{formatWon(beforeBudget)} → ₩{formatWon(afterBudget)}</b></span>
            <span>선택 <b>{chosen.length}/{changes.length}</b></span>
          </div>
          <button className="primary-button full" type="button" disabled={!chosen.length} onClick={() => onApply(chosen)}>
            선택한 {chosen.length}개 적용
          </button>
          <button className="outline-button full" type="button" onClick={() => setPhase("idle")}>다시 요청하기</button>
        </div>
      )}

      {phase === "preview" && mode === "generate" && (
        <div className="ai-proposal">
          <div className="proposal-title">
            <span>AI 일정 3안</span>
            <b>{options.length}개</b>
          </div>
          {note && <p className="proposal-summary-text">{note}</p>}
          <div className="plan-option-list">
            {options.map(option => (
              <button
                key={option.key}
                type="button"
                className={`plan-option-card ${optionKey === option.key ? "is-selected" : ""}`}
                onClick={() => setOptionKey(option.key)}
              >
                <span>{option.key} · {option.styleLabel}</span>
                <b>{option.title}</b>
                <small>{option.summary}</small>
                <em>₩{formatWon(option.totalCost)} · {option.placeCount}곳</em>
              </button>
            ))}
          </div>
          {activeOption && (
            <ul className="plan-option-preview">
              {activeOption.items.map(item => (
                <li key={item.id}>
                  <b>{item.startTime}</b>
                  <span>{item.placeName}</span>
                  <small>{item.durationMinutes}분</small>
                </li>
              ))}
            </ul>
          )}
          <button
            className="primary-button full"
            type="button"
            disabled={!activeOption}
            onClick={() => {
              if (!activeOption) return;
              onReplace(activeOption.items);
            }}
          >
            {activeOption ? `${activeOption.key}안 적용` : "안을 선택해 주세요"}
          </button>
          <button className="outline-button full" type="button" onClick={() => setPhase("idle")}>다시 만들기</button>
        </div>
      )}

      <p className="form-hint">
        {mode === "generate"
          ? "AI는 새 장소를 만들지 않아요. Places에 저장된 장소만 골라 순서를 정합니다."
          : "AI는 새 장소를 만들지 않아요. 이미 담긴 일정만 삭제하거나 체류 시간을 조정합니다."}
      </p>
    </div>
  );
}

"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  TASTE_ACTIVITY_OPTIONS,
  TASTE_AREA_CATALOG,
  TASTE_AVOID_OPTIONS,
  TASTE_CROWD_OPTIONS,
  TASTE_CUISINE_OPTIONS,
  TASTE_DATE_FLOW_OPTIONS,
  TASTE_DRINK_OPTIONS,
  TASTE_INDOOR_OPTIONS,
  TASTE_PACE_OPTIONS,
  TASTE_SETTING_OPTIONS,
  TASTE_TIME_OPTIONS,
  areaGroupId,
  canonicalizeArea,
  labelForActivity,
  labelForCrowd,
  labelForCuisine,
  labelForDateFlow,
  labelForDrink,
  labelForPace,
  labelForSetting,
  labelForTime,
} from "../options";
import { findRegionByArea, flattenRegionAreas } from "../areaCatalog";
import type { TasteAreaScope } from "../areaCatalog";

const AREA_SCOPES: readonly TasteAreaScope[] = ["seoul", "metro", "trip"];
import { allowedAvoid } from "../parse";
import type { TasteCuisine, TasteInput } from "../types";
import type { DateActivityId } from "@/features/planning/types/plan";

const MAX_AREAS = 4;

const AREA_SCOPE_LABEL: Record<"seoul" | "metro" | "trip", string> = {
  seoul: "서울",
  metro: "수도권",
  trip: "여행",
};

const STEPS = [
  {
    id: "area",
    title: "자주 가는 동네",
    short: "장소",
    hint: "권역을 고른 뒤, 자주 걷는 골목을 최대 네 곳 남겨 주세요.",
    next: "하루 정하기",
  },
  {
    id: "rhythm",
    title: "하루 보내는 방식",
    short: "하루",
    hint: "속도·하고 싶은 것·코스 순서·시작 시간을 남기면 데이트 뼈대가 잡혀요.",
    next: "음식·분위기",
  },
  {
    id: "table",
    title: "식사와 분위기",
    short: "음식",
    hint: "둘 중 한 명이라도 먹기 어려운 음식은 추천에서 빼드릴게요.",
    next: "기준 저장",
  },
] as const;

const ACTIVITY_HINT: Record<string, string> = {
  meal: "하루의 한 끼",
  cafe: "앉아서 쉬기",
  walk: "골목과 풍경",
  exhibit: "보고 이야기",
  indoor: "날씨에 기대지 않기",
  nightview: "해가 진 뒤",
};

function toggle<T extends string>(current: T[], value: T, max: number) {
  if (current.includes(value)) return current.filter(item => item !== value);
  if (current.length >= max) return [...current.slice(1), value];
  return [...current, value];
}

function StepBlock({
  title,
  hint,
  count,
  children,
}: {
  title: string;
  hint?: string;
  count?: string;
  children: ReactNode;
}) {
  return (
    <section className="taste-step-block">
      <header className="taste-step-block-head">
        <div>
          <b>{title}</b>
          {hint ? <span>{hint}</span> : null}
        </div>
        {count ? <small>{count}</small> : null}
      </header>
      {children}
    </section>
  );
}

function Group({
  open,
  children,
}: {
  open: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`taste-group${open ? " is-open" : ""}`} inert={!open}>
      {children}
    </div>
  );
}

function CheckMark() {
  return (
    <svg className="taste-check" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.2 8.4 6.1 11.2 12.8 4.4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function NextMark() {
  return (
    <svg className="taste-next-mark" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M5 3.2 10.8 8 5 12.8" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function missingForStep(step: number, draft: TasteInput) {
  if (step === 0) return draft.areas.length ? "" : "자주 가는 동네를 한 곳 이상 골라 주세요.";
  if (step === 1) {
    if (!draft.pace) return "하루의 속도를 골라 주세요.";
    if (!draft.activities.length) return "하고 싶은 걸 하나 이상 골라 주세요.";
    if (!draft.dateFlow) return "코스 순서를 골라 주세요.";
    if (!draft.timeWindow) return "보통 시작하는 시간을 골라 주세요.";
    if (draft.activities.includes("indoor") && !draft.indoorPlay) return "실내 놀이 종류를 골라 주세요.";
    return "";
  }
  if (!draft.cuisines.length) return "편한 식사를 골라 주세요.";
  if (!draft.setting) return "실내와 야외 중 편한 쪽을 골라 주세요.";
  if (!draft.crowd) return "거리 분위기를 골라 주세요.";
  return "";
}

function previewLine(values: string[], empty: string) {
  return values.filter(Boolean).join(" · ") || empty;
}

export function TasteForm({
  initial,
  youName,
  pending,
  error,
  onCancel,
  onSave,
}: {
  initial: TasteInput;
  youName: string;
  pending: boolean;
  error: string;
  onCancel?: () => void;
  onSave: (input: TasteInput) => void;
}) {
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState<"forward" | "back">("forward");
  const [draft, setDraft] = useState<TasteInput>(initial);
  const [areaDraft, setAreaDraft] = useState("");
  const [avoidDraft, setAvoidDraft] = useState("");
  const [areaGroup, setAreaGroup] = useState(() => {
    const selected = initial.areas.map(areaGroupId).find(Boolean);
    return selected || TASTE_AREA_CATALOG[0].id;
  });
  const [areaScope, setAreaScope] = useState<TasteAreaScope>(() => {
    const selected = initial.areas.map(areaGroupId).find(Boolean) || TASTE_AREA_CATALOG[0].id;
    return TASTE_AREA_CATALOG.find(region => region.id === selected)?.scope ?? "seoul";
  });

  const extraAvoids = draft.avoidFoods.filter(item => !(TASTE_AVOID_OPTIONS as readonly string[]).includes(item));
  const currentRegion = TASTE_AREA_CATALOG.find(region => region.id === areaGroup) ?? TASTE_AREA_CATALOG[0];
  const regionsInScope = useMemo(
    () => TASTE_AREA_CATALOG.filter(region => region.scope === areaScope),
    [areaScope],
  );

  const scopePickCounts = useMemo(() => {
    const counts: Record<TasteAreaScope, number> = { seoul: 0, metro: 0, trip: 0 };
    for (const area of draft.areas) {
      const region = findRegionByArea(area);
      if (region) {
        counts[region.scope] += 1;
        continue;
      }
      const groupId = areaGroupId(area);
      const fallback = groupId ? TASTE_AREA_CATALOG.find(item => item.id === groupId) : undefined;
      if (fallback) counts[fallback.scope] += 1;
    }
    return counts;
  }, [draft.areas]);

  function selectAreaScope(scope: TasteAreaScope) {
    setAreaScope(scope);
    const active = TASTE_AREA_CATALOG.find(region => region.id === areaGroup);
    if (active?.scope === scope) return;
    const fallback = TASTE_AREA_CATALOG.find(region => region.scope === scope);
    if (fallback) setAreaGroup(fallback.id);
  }

  function selectAreaRegion(regionId: string) {
    setAreaGroup(regionId);
    const region = TASTE_AREA_CATALOG.find(item => item.id === regionId);
    if (region) setAreaScope(region.scope);
  }

  const stepReady = [
    draft.areas.length > 0,
    Boolean(
      draft.pace
      && draft.activities.length
      && draft.dateFlow
      && draft.timeWindow
      && (!draft.activities.includes("indoor") || draft.indoorPlay),
    ),
    Boolean(draft.cuisines.length && draft.setting && draft.crowd),
  ];

  const checks = [
    draft.areas.length > 0,
    Boolean(draft.pace),
    draft.activities.length > 0,
    Boolean(draft.timeWindow),
    Boolean(draft.dateFlow),
    draft.cuisines.length > 0,
    Boolean(draft.setting),
    Boolean(draft.crowd),
  ];
  const filled = checks.filter(Boolean).length;
  const progress = Math.round((filled / checks.length) * 100);
  const missing = missingForStep(step, draft);

  const preview = useMemo(() => ([
    { label: "장소", value: previewLine(draft.areas, ""), set: draft.areas.length > 0 },
    { label: "속도", value: draft.pace ? labelForPace(draft.pace) : "", set: Boolean(draft.pace) },
    { label: "하고 싶은 것", value: previewLine(draft.activities.map(labelForActivity), ""), set: draft.activities.length > 0 },
    { label: "시간", value: draft.timeWindow ? labelForTime(draft.timeWindow) : "", set: Boolean(draft.timeWindow) },
    { label: "순서", value: draft.dateFlow ? labelForDateFlow(draft.dateFlow) : "", set: Boolean(draft.dateFlow) },
    {
      label: "실내",
      value: draft.indoorPlay && draft.indoorPlay !== "상관없음" ? draft.indoorPlay : "",
      set: Boolean(draft.activities.includes("indoor") && draft.indoorPlay),
    },
    { label: "식사", value: previewLine(draft.cuisines.map(labelForCuisine), ""), set: draft.cuisines.length > 0 },
    {
      label: "술",
      value: draft.drink && draft.drink !== "any" ? labelForDrink(draft.drink) : "",
      set: Boolean(draft.drink && draft.drink !== "any"),
    },
    { label: "빼는 것", value: previewLine(draft.avoidFoods.map(item => `${item} 제외`), ""), set: draft.avoidFoods.length > 0 },
    { label: "분위기", value: previewLine([
      draft.setting ? labelForSetting(draft.setting) : "",
      draft.crowd ? labelForCrowd(draft.crowd) : "",
    ], ""), set: Boolean(draft.setting || draft.crowd) },
  ]), [draft]);

  const previewStepLabels = useMemo(() => {
    if (step === 0) return ["장소"];
    if (step === 1) return ["속도", "하고 싶은 것", "순서", "시간", "실내"];
    return ["식사", "술", "빼는 것", "분위기"];
  }, [step]);

  const previewLedger = useMemo(
    () => preview.filter(item => item.set || previewStepLabels.includes(item.label)),
    [preview, previewStepLabels],
  );

  function go(next: number) {
    if (next === step) return;
    if (next > step) {
      for (let index = step; index < next; index += 1) {
        if (!stepReady[index]) return;
      }
    }
    setDir(next > step ? "forward" : "back");
    setStep(next);
  }

  function canVisit(index: number) {
    if (index <= step) return true;
    return stepReady.slice(0, index).every(Boolean);
  }

  function addArea() {
    const next = canonicalizeArea(areaDraft);
    if (!next) return;
    setDraft(current => ({
      ...current,
      areas: current.areas.includes(next) ? current.areas : toggle(current.areas, next, MAX_AREAS),
    }));
    setAreaGroup(areaGroupId(next) || areaGroup);
    setAreaDraft("");
  }

  function addAvoid() {
    const next = allowedAvoid(avoidDraft);
    if (!next) return;
    setDraft(current => ({
      ...current,
      avoidFoods: current.avoidFoods.includes(next) ? current.avoidFoods : toggle(current.avoidFoods, next, 8),
    }));
    setAvoidDraft("");
  }

  function setCuisine(id: TasteCuisine) {
    setDraft(current => {
      if (id === "any") return { ...current, cuisines: current.cuisines.includes("any") ? [] : ["any"] };
      const withoutAny = current.cuisines.filter(item => item !== "any");
      return { ...current, cuisines: toggle(withoutAny, id, 4) };
    });
  }

  return (
    <form
      className={`taste-form is-${dir} is-split-step${step === 0 ? " is-area-step" : step === 1 ? " is-rhythm-step" : " is-table-step"}`}
      onSubmit={event => {
        event.preventDefault();
        if (step < 2) {
          if (stepReady[step]) go(step + 1);
          return;
        }
        if (stepReady[2]) onSave(draft);
      }}
    >
      <div className="taste-form-cap">
        <div className="taste-form-accent" aria-hidden="true" />
        <header className="taste-form-head">
          <div className="taste-form-kicker">
            <span className="eyebrow">MY DATE BASELINE</span>
            <small>{youName}의 한 장</small>
          </div>
          <div className="taste-form-title">
            <h2>{STEPS[step].title}</h2>
            <p>{STEPS[step].hint}</p>
          </div>
          <div
            className="taste-progress"
            role="progressbar"
            aria-label="기준 입력 진행"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
          >
            <i style={{ width: `${progress}%` }} />
          </div>
          <ol className="taste-steps" aria-label="기준 입력 단계">
            {STEPS.map((item, index) => (
              <li
                key={item.id}
                className={index === step ? "is-current" : index < step && stepReady[index] ? "is-done" : undefined}
              >
                <button
                  type="button"
                  disabled={!canVisit(index)}
                  onClick={() => go(index)}
                  aria-current={index === step ? "step" : undefined}
                >
                  <span className="taste-step-index">
                    {index < step && stepReady[index] ? <CheckMark /> : String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="taste-step-copy">
                    <small>STEP {String(index + 1).padStart(2, "0")}</small>
                    <b>{item.short}</b>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </header>
      </div>

      <div className="taste-form-layout is-split-step">
        <div className={`taste-stage is-${dir}`} key={step}>
          {step === 0 && (
            <section className="taste-form-section taste-area-board">
              <div className="taste-picked taste-picked--compact">
                <ul aria-label="담은 동네">
                  {draft.areas.map(area => (
                    <li key={area}>
                      <button
                        type="button"
                        aria-label={`${area} 빼기`}
                        onClick={() => setDraft(current => ({
                          ...current,
                          areas: current.areas.filter(item => item !== area),
                        }))}
                      >
                        {area}
                      </button>
                    </li>
                  ))}
                  {!draft.areas.length ? <li className="is-empty">최대 {MAX_AREAS}곳</li> : null}
                </ul>
                <label className="taste-add is-inline">
                  <span>목록에 없으면</span>
                  <input
                    value={areaDraft}
                    onChange={event => setAreaDraft(event.target.value)}
                    onKeyDown={event => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addArea();
                      }
                    }}
                    placeholder="직접 추가"
                    maxLength={12}
                    aria-label="동네 직접 입력"
                  />
                  <button type="button" className="outline-button" onClick={addArea}>추가</button>
                </label>
                <small className={draft.areas.length >= MAX_AREAS ? "is-full" : undefined}>
                  {draft.areas.length}/{MAX_AREAS}
                </small>
              </div>
              {draft.areas.length >= MAX_AREAS ? (
                <p className="taste-area-limit-hint">
                  네 곳이 찼어요. 다른 동네를 고르면 가장 먼저 담은 곳이 바뀌어요.
                </p>
              ) : null}
              <div className="taste-area-scope-panel">
                <div className="taste-segment taste-segment--scope" role="tablist" aria-label="권역 범위">
                  {AREA_SCOPES.map(scope => (
                    <button
                      key={scope}
                      type="button"
                      role="tab"
                      aria-selected={areaScope === scope}
                      className={areaScope === scope ? "is-active" : undefined}
                      onClick={() => selectAreaScope(scope)}
                    >
                      {AREA_SCOPE_LABEL[scope]}
                      {scopePickCounts[scope] ? (
                        <i aria-label={`${scopePickCounts[scope]}곳 선택`}>{scopePickCounts[scope]}</i>
                      ) : null}
                    </button>
                  ))}
                </div>
                <div className="taste-area-region-grid" role="tablist" aria-label="권역">
                  {regionsInScope.map(region => {
                    const regionAreas = flattenRegionAreas(region);
                    const selectedCount = regionAreas.filter(area => draft.areas.includes(area)).length;
                    const current = region.id === currentRegion.id;
                    return (
                      <button
                        key={region.id}
                        type="button"
                        role="tab"
                        aria-selected={current}
                        className={`taste-area-region-chip${current ? " is-active" : ""}`}
                        onClick={() => selectAreaRegion(region.id)}
                        title={`${region.subtitle}. ${region.hint}`}
                      >
                        <span>{region.label}</span>
                        <small>{region.subtitle}</small>
                        {selectedCount ? <i>{selectedCount}</i> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="taste-area-region-bar" key={currentRegion.id}>
                <p className="taste-area-region-copy">{currentRegion.hint}</p>
                <ul className="taste-area-moods taste-area-moods--inline" aria-label="이 권역 분위기">
                  {currentRegion.moods.map(mood => (
                    <li key={mood}>{mood}</li>
                  ))}
                </ul>
              </div>
              <div className="taste-area-stack" aria-label={`${currentRegion.label} 동네 목록`}>
                {currentRegion.sections.map(section => (
                  <section className="taste-area-section-block" key={section.id}>
                    <header className="taste-area-section-block-head">
                      <b>{section.label}</b>
                      <span>{section.tagline}</span>
                    </header>
                    <div className="taste-area-grid taste-area-grid--chips">
                      {section.spots.map(spot => {
                        const active = draft.areas.includes(spot.name);
                        return (
                          <button
                            key={spot.name}
                            type="button"
                            className={`taste-area taste-area--chip${active ? " is-active" : ""}`}
                            aria-pressed={active}
                            aria-label={spot.vibe ? `${spot.name}, ${spot.vibe}` : spot.name}
                            title={spot.vibe ? `${spot.name} · ${spot.vibe}` : spot.name}
                            onClick={() => setDraft(current => ({
                              ...current,
                              areas: toggle(current.areas, spot.name, MAX_AREAS),
                            }))}
                          >
                            {spot.name}
                          </button>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            </section>
          )}

          {step === 1 && (
            <section className="taste-form-section taste-step-board">
              <div className="taste-step-stack">
                <StepBlock title="하루의 속도" hint="코스가 얼마나 숨 가쁠지를 정해요.">
                  <div className="taste-tile-grid" role="radiogroup" aria-label="데이트 페이스">
                    {TASTE_PACE_OPTIONS.map(option => {
                      const active = draft.pace === option.id;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          className={`taste-pick-tile${active ? " is-active" : ""}`}
                          aria-pressed={active}
                          onClick={() => setDraft(current => ({ ...current, pace: option.id }))}
                        >
                          <span>{option.label}</span>
                          <small>{option.hint}</small>
                          {active ? <CheckMark /> : null}
                        </button>
                      );
                    })}
                  </div>
                </StepBlock>
                <Group open={Boolean(draft.pace)}>
                  <StepBlock
                    title="하루를 채우고 싶은 것"
                    count={`${draft.activities.length}/4`}
                    hint="최대 네 가지. 코스의 뼈대가 됩니다."
                  >
                    <div className="taste-area-grid taste-area-grid--chips">
                      {TASTE_ACTIVITY_OPTIONS.map(option => {
                        const active = draft.activities.includes(option.id);
                        return (
                          <button
                            key={option.id}
                            type="button"
                            className={`taste-area taste-area--chip${active ? " is-active" : ""}`}
                            aria-pressed={active}
                            onClick={() => setDraft(current => {
                              const activities = toggle(current.activities, option.id as DateActivityId, 4);
                              const hasIndoor = activities.includes("indoor");
                              return {
                                ...current,
                                activities,
                                indoorPlay: hasIndoor ? (current.indoorPlay || "상관없음") : "",
                              };
                            })}
                          >
                            <span className="taste-area-name">{option.label}</span>
                            <span className="taste-area-tag">{ACTIVITY_HINT[option.id] ?? ""}</span>
                            {active ? <CheckMark /> : null}
                          </button>
                        );
                      })}
                    </div>
                  </StepBlock>
                </Group>
                <Group open={Boolean(draft.pace && draft.activities.length)}>
                  {draft.activities.includes("indoor") ? (
                    <StepBlock title="실내 놀이" hint="실내를 고르셨을 때만 코스 검색에 반영돼요.">
                      <div className="taste-area-grid taste-area-grid--chips is-indoor">
                        {TASTE_INDOOR_OPTIONS.map(option => {
                          const active = draft.indoorPlay === option;
                          return (
                            <button
                              key={option}
                              type="button"
                              className={`taste-area taste-area--chip${active ? " is-active" : ""}`}
                              aria-pressed={active}
                              onClick={() => setDraft(current => ({ ...current, indoorPlay: option }))}
                            >
                              <span className="taste-area-name">{option}</span>
                            </button>
                          );
                        })}
                      </div>
                    </StepBlock>
                  ) : null}
                  <StepBlock title="코스 순서" hint="식사와 카페·산책 중 무엇을 먼저 할지 정해요.">
                    <div className="taste-tile-grid" role="radiogroup" aria-label="코스 순서">
                      {TASTE_DATE_FLOW_OPTIONS.map(option => {
                        const active = draft.dateFlow === option.id;
                        return (
                          <button
                            key={option.id}
                            type="button"
                            className={`taste-pick-tile${active ? " is-active" : ""}`}
                            aria-pressed={active}
                            onClick={() => setDraft(current => ({ ...current, dateFlow: option.id }))}
                          >
                            <span>{option.label}</span>
                            <small>{option.hint}</small>
                            {active ? <CheckMark /> : null}
                          </button>
                        );
                      })}
                    </div>
                  </StepBlock>
                  <StepBlock title="보통 시작하는 시간">
                    <div className="taste-segment taste-segment--wizard" role="radiogroup" aria-label="시작하는 시간">
                      {TASTE_TIME_OPTIONS.map(option => (
                        <button
                          key={option.id}
                          type="button"
                          className={draft.timeWindow === option.id ? "is-active" : undefined}
                          aria-pressed={draft.timeWindow === option.id}
                          onClick={() => setDraft(current => ({ ...current, timeWindow: option.id }))}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </StepBlock>
                </Group>
              </div>
            </section>
          )}

          {step === 2 && (
            <section className="taste-form-section taste-step-board">
              <div className="taste-step-stack">
                <StepBlock title="편한 식사" hint="상관없음을 고르면 나머지는 비워요.">
                  <div className="taste-area-grid taste-area-grid--chips taste-area-grid--cuisine">
                    {TASTE_CUISINE_OPTIONS.map(option => {
                      const active = draft.cuisines.includes(option.id);
                      return (
                        <button
                          key={option.id}
                          type="button"
                          className={`taste-area taste-area--chip${active ? " is-active" : ""}`}
                          aria-pressed={active}
                          onClick={() => setCuisine(option.id)}
                        >
                          <span className="taste-area-name">{option.label}</span>
                          {active ? <CheckMark /> : null}
                        </button>
                      );
                    })}
                  </div>
                </StepBlock>
                <StepBlock title="술 한잔" hint="코스에 술자리를 넣을지 정해요.">
                  <div className="taste-segment taste-segment--wizard" role="radiogroup" aria-label="술">
                    {TASTE_DRINK_OPTIONS.map(option => (
                      <button
                        key={option.id}
                        type="button"
                        className={draft.drink === option.id ? "is-active" : undefined}
                        aria-pressed={draft.drink === option.id}
                        onClick={() => setDraft(current => ({ ...current, drink: option.id }))}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </StepBlock>
                <Group open={draft.cuisines.length > 0}>
                  <StepBlock title="코스에서 빼 주세요" hint="여기는 제한입니다. 상대 코스에서도 빠집니다.">
                    <div className="taste-avoid-row">
                      {[...TASTE_AVOID_OPTIONS, ...extraAvoids].map(option => {
                        const active = draft.avoidFoods.includes(option);
                        return (
                          <button
                            key={option}
                            type="button"
                            className={`taste-area taste-area--chip${active ? " is-active" : ""}`}
                            aria-pressed={active}
                            onClick={() => setDraft(current => ({
                              ...current,
                              avoidFoods: toggle(current.avoidFoods, option, 8),
                            }))}
                          >
                            <span className="taste-area-name">{option}</span>
                          </button>
                        );
                      })}
                      <label className="taste-avoid-add">
                        <span className="taste-avoid-add-label">더 빼야 하는 것</span>
                        <input
                          value={avoidDraft}
                          onChange={event => setAvoidDraft(event.target.value)}
                          onKeyDown={event => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              addAvoid();
                            }
                          }}
                          placeholder="알레르기·싫어하는 음식"
                          maxLength={16}
                          aria-label="더 빼야 하는 것 직접 입력"
                        />
                        <button type="button" className="outline-button" onClick={addAvoid}>추가</button>
                      </label>
                    </div>
                  </StepBlock>
                  <StepBlock title="실내 / 야외">
                    <div className="taste-segment taste-segment--wizard" role="radiogroup" aria-label="실내 야외">
                      {TASTE_SETTING_OPTIONS.map(option => (
                        <button
                          key={option.id}
                          type="button"
                          className={draft.setting === option.id ? "is-active" : undefined}
                          aria-pressed={draft.setting === option.id}
                          onClick={() => setDraft(current => ({ ...current, setting: option.id }))}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </StepBlock>
                  <StepBlock title="거리 분위기">
                    <div className="taste-segment taste-segment--wizard" role="radiogroup" aria-label="거리 분위기">
                      {TASTE_CROWD_OPTIONS.map(option => (
                        <button
                          key={option.id}
                          type="button"
                          className={draft.crowd === option.id ? "is-active" : undefined}
                          aria-pressed={draft.crowd === option.id}
                          onClick={() => setDraft(current => ({ ...current, crowd: option.id }))}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </StepBlock>
                  <StepBlock title="상대에게 전하고 싶은 한 줄">
                    <div className="taste-note taste-note--board">
                      <input
                        value={draft.note}
                        onChange={event => setDraft(current => ({ ...current, note: event.target.value.slice(0, 160) }))}
                        placeholder="비 오는 날은 실내가 좋아요"
                        maxLength={160}
                        aria-label="상대에게 전하고 싶은 한 줄"
                      />
                      <small>{draft.note.length}/160</small>
                    </div>
                  </StepBlock>
                </Group>
              </div>
            </section>
          )}
        </div>

        <aside className="taste-preview" aria-label="지금까지 남긴 기준">
          <div className="taste-preview-head">
            <div>
              <small>NOW WRITING</small>
              <h3>지금 남기는 기준</h3>
            </div>
          </div>
          <div className="taste-preview-body">
            <dl className="taste-preview-ledger">
              {previewLedger.map(item => {
                const focus = previewStepLabels.includes(item.label);
                return (
                  <div
                    key={item.label}
                    className={`taste-preview-row${item.set ? " is-set" : " is-empty"}${focus ? " is-focus" : ""}`}
                  >
                    <dt>{item.label}</dt>
                    <dd>{item.set ? item.value : "고르면 여기에 쌓여요"}</dd>
                  </div>
                );
              })}
            </dl>
            {draft.note ? <p className="taste-preview-note">{draft.note}</p> : null}
          </div>
          <div className="taste-preview-foot" aria-label="기준 입력 진행">
            <span className="taste-preview-count">{filled}/{checks.length}</span>
            <div
              className="taste-preview-meter"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={checks.length}
              aria-valuenow={filled}
            >
              <i style={{ width: `${progress}%` }} />
            </div>
          </div>
        </aside>
      </div>

      {error ? <p className="form-error" role="alert">{error}</p> : null}

      <footer className="taste-form-foot">
        {step > 0 ? (
          <button type="button" className="text-button" onClick={() => go(step - 1)}>이전</button>
        ) : onCancel ? (
          <button type="button" className="text-button" onClick={onCancel}>돌아가기</button>
        ) : <span />}
        <p className="taste-foot-hint" aria-live="polite">
          {pending ? "저장하는 중이에요." : missing || (step < 2 ? "고른 내용이 미리보기에 바로 반영돼요." : "저장하면 상대와 비교할 기준이 됩니다.")}
        </p>
        <button
          className="primary-button taste-next"
          type="submit"
          disabled={pending || !stepReady[step]}
        >
          <span>{pending ? "저장하는 중" : step < 2 ? STEPS[step].next : STEPS[2].next}</span>
          {pending ? <i className="taste-spinner" aria-hidden="true" /> : <NextMark />}
        </button>
      </footer>
    </form>
  );
}

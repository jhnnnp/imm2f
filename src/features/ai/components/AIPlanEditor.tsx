"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { proposePlanEdits, recommendDatePlan } from "../actions";
import {
  DATE_KEEP_LABEL,
  TRIP_KEEP_LABEL,
  courseDayCount,
  courseKeepTitle,
  keepIntent,
  staySpanLabel,
  tripEndDate,
  type CourseKeepInput,
  type CourseKeepResult,
} from "../courseKeep";
import {
  emptyDateBrief,
  missingSlot,
  slotQuestion,
  withActivities,
  withAreas,
  withAreaScope,
  withCuisine,
  withStayKind,
  withTimeWindow,
} from "../dateBrief";
import { isCourseQuickAction } from "../dateCourse";
import { pendingLabelFor } from "../chatRoute";
import type { AIChatCard, AIChatStop, AIPlannerReply, AIPlannerState, DateIntakeSlot, PlanChange, PlanItem, PlanKind } from "@/features/planning/types/plan";
import type { Place } from "@/features/places/types/place";
import { plannerStateFromSeed } from "@/features/taste/compare";
import type { TasteDateSeed } from "@/features/taste/types";
import { CalendarMonth } from "@/components/shared/CalendarMonth";
import { PlaceLocationMap } from "@/features/places/components/PlaceLocationMap";
import { PlanMap } from "@/features/trip/components/PlanMap";
import { kakaoPlaceUrl, naverPlaceSearchUrl } from "@/features/places/format";
import { openPlaceMiniWindow } from "@/features/places/openPlaceMini";
import { formatKoPicker, toIsoDate } from "@/lib/dates";

function sourceHost(url: string) {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return "";
  }
}

const EDIT_PROMPT = "일정이 조금 빡센 것 같아. 한곳 빼고 남는 곳은 더 여유롭게 해줘.";
const GENERATE_PLACEHOLDER = "예: 성수 파스타 맛집 추천해줘";
const COURSE_PLACEHOLDER = "예: 식당 변경 해줘 · 1번 주차 돼?";
const WELCOME_CARD: AIChatCard = {
  headline: "어디로 갈까요?",
  lines: ["동네를 말하면 하루 코스를 짜고, 식당이나 카페만 골라 달라고 해도 돼요. 만든 뒤에는 주차나 예약 같은 질문도 이어서 할 수 있어요."],
  suggestions: ["성수 파스타 맛집 추천해줘", "을지로 저녁 데이트 코스 짜줘", "비 오는 날 홍대 실내 데이트"],
};

type KeepStep = "idle" | "destination" | "trip-dates";

function stopKakaoUrl(stop: AIChatStop) {
  const raw = stop.mapUrl?.trim();
  if (raw) return raw.replace(/^http:\/\//, "https://");
  return kakaoPlaceUrl(stop.name, stop.coordinates);
}

function formatHop(meters: number | null | undefined) {
  if (meters == null) return "";
  if (meters < 80) return "바로 옆";
  const walk = Math.max(1, Math.round(meters / 80));
  if (meters < 1000) return `직선 ${meters}m · 도보 약 ${walk}분`;
  return `직선 ${(meters / 1000).toFixed(1)}km · 도보 약 ${walk}분`;
}

function formatRouteLength(meters: number) {
  if (meters < 1000) return `${meters}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

type ChatTurn = {
  role: "user" | "assistant";
  text: string;
  card?: AIChatCard;
};

type Mode = "edit" | "generate";
type ChoicePrompt = { options: string[]; multiple: boolean; kind: DateIntakeSlot };

function slotPrompt(slot: DateIntakeSlot, state?: AIPlannerState): ChoicePrompt {
  const question = slotQuestion(slot, state);
  return { options: question.options, multiple: question.multiple, kind: slot };
}

function applySlot(kind: DateIntakeSlot, choices: string[], state: AIPlannerState): AIPlannerState {
  if (kind === "activity") return withActivities(state, choices);
  if (kind === "area") return withAreas(state, choices);
  if (kind === "scope") return withAreaScope(state, choices[0] ?? "");
  if (kind === "span") return withStayKind(state, choices[0] ?? "");
  if (kind === "time") return withTimeWindow(state, choices[0] ?? "");
  if (kind === "cuisine") return withCuisine(state, choices[0] ?? "");
  return { ...state, indoorPlay: choices[0] ?? null, pendingSlot: null };
}

function slotUserText(kind: DateIntakeSlot, choices: string[]) {
  if (kind === "activity") return `${choices.join(", ")} 하고 싶어`;
  if (kind === "area") return `${choices.join(", ")} 쪽이 좋아`;
  if (kind === "scope") return choices[0] ?? "주변 범위를 정했어";
  if (kind === "span") return `${choices[0] ?? "데이트"}로 짜줘`;
  if (kind === "time") return choices[0] === "상관없음" ? "시간은 상관없어" : `${choices[0]} 시작하면 좋겠어`;
  if (kind === "cuisine") return choices[0] === "상관없음" ? "식사는 알아서 골라줘" : `${choices[0]} 먹고 싶어`;
  return choices[0] === "상관없음" ? "실내는 알아서 골라줘" : `${choices[0]} 하고 싶어`;
}

function CoursePlacePeek({ stop, onClose }: { stop: AIChatStop; onClose: () => void }) {
  const kakaoUrl = stopKakaoUrl(stop);
  const naverUrl = naverPlaceSearchUrl(stop.name, stop.address);
  const phone = stop.phone?.replace(/\s+/g, "") ?? "";
  const host = stop.source === "tourapi" ? "visitkorea.or.kr" : "place.map.kakao.com";
  return (
    <section className="ai-place-peek" id="ai-place-peek" aria-label={`${stop.name} 미리보기`}>
      <header>
        <div>
          <b>{stop.name}</b>
          <p>{stop.meta}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="미리보기 닫기">닫기</button>
      </header>
      <div className="ai-mini-web">
        <div className="ai-mini-web-chrome">
          <span>{host}</span>
          <button type="button" onClick={() => openPlaceMiniWindow(kakaoUrl, "kakao")}>보기</button>
        </div>
        {stop.image ? (
          <button type="button" className="ai-mini-web-photo" onClick={() => openPlaceMiniWindow(kakaoUrl, "kakao")} aria-label={`${stop.name} 카카오맵에서 보기`}>
            <img src={stop.image} alt="" />
          </button>
        ) : (
          <button type="button" className="ai-mini-web-empty" onClick={() => openPlaceMiniWindow(kakaoUrl, "kakao")}>
            <b>사진과 후기</b>
            <small>지도에서 확인할 수 있습니다.</small>
          </button>
        )}
      </div>
      {stop.reason ? <p className="ai-place-peek-reason">{stop.reason}</p> : null}
      {stop.coordinates ? <PlaceLocationMap name={stop.name} coordinates={stop.coordinates} /> : null}
      {(stop.address || phone || stop.openingHours || stop.rating != null || stop.dishes) ? (
        <dl className="ai-place-peek-facts">
          {stop.rating != null ? <div><dt>평점</dt><dd>{stop.rating}점{stop.ratingCount ? ` · 후기 ${stop.ratingCount}` : ""}</dd></div> : null}
          {stop.dishes ? <div><dt>음식</dt><dd>{stop.dishes}</dd></div> : null}
          {stop.factSourceUrl ? <div><dt>출처</dt><dd><a href={stop.factSourceUrl} target="_blank" rel="noreferrer">{sourceHost(stop.factSourceUrl) || "검색 결과"}</a></dd></div> : null}
          {stop.address ? <div><dt>주소</dt><dd>{stop.address}</dd></div> : null}
          {stop.openingHours ? <div><dt>{stop.source === "tourapi" ? "기간" : "이용시간"}</dt><dd>{stop.openingHours}</dd></div> : null}
          {phone ? <div><dt>전화</dt><dd><a href={`tel:${phone}`}>{stop.phone}</a></dd></div> : null}
        </dl>
      ) : null}
      <div className="external-place-links">
        <span className="external-place-links-label">전체 페이지</span>
        <div className="map-app-grid">
          <button type="button" className="map-app-link is-kakao" onClick={() => openPlaceMiniWindow(kakaoUrl, "kakao")} aria-label={`${stop.name} 카카오맵에서 보기`}>
            <span className="map-service-lockup"><b className="kakao-wordmark">kakao map</b><small>보기</small></span><em aria-hidden="true">↗</em>
          </button>
          <button type="button" className="map-app-link is-naver" onClick={() => openPlaceMiniWindow(naverUrl, "naver")} aria-label={`${stop.name} 네이버 지도에서 보기`}>
            <span className="map-service-lockup"><b className="naver-wordmark">NAVER</b><small>보기</small></span><em aria-hidden="true">↗</em>
          </button>
        </div>
      </div>
    </section>
  );
}

function AssistantCard({
  card,
  text,
  options,
  selectedChoices,
  disabled,
  openStopKey,
  onOpenStop,
  onPick,
  onToggle,
  onSubmit,
}: {
  card?: AIChatCard;
  text: string;
  options?: ChoicePrompt | null;
  selectedChoices: string[];
  disabled?: boolean;
  openStopKey?: string | null;
  onOpenStop?: (key: string, stop: AIChatStop) => void;
  onPick: (label: string) => void;
  onToggle?: (label: string) => void;
  onSubmit?: () => void;
}) {
  const lines = card?.lines?.length ? card.lines : text ? [text] : [];
  const chips = options?.options?.length ? options.options : (card?.suggestions ?? []);
  const courseActions = chips.length > 0 && chips.every(chip => isCourseQuickAction(chip));
  return (
    <article className="ai-bubble is-assistant">
      {card?.headline ? <b>{card.headline}</b> : null}
      {lines.map(line => <p key={line}>{line}</p>)}
      {card?.stops?.length ? (
        <ol className="ai-bubble-stops">
          {card.stops.map((stop, index) => {
            const key = `${stop.name}-${index}`;
            const open = openStopKey === key;
            const multiDay = card.stops?.some(item => (item.dayIndex ?? 0) > 0) ?? false;
            const showDay = multiDay && (index === 0 || (card.stops?.[index - 1]?.dayIndex ?? 0) !== (stop.dayIndex ?? 0));
            const kakaoUrl = stopKakaoUrl(stop);
            return (
              <li key={key}>
                {showDay ? <p className="ai-stop-day">{(stop.dayIndex ?? 0) + 1}일차</p> : null}
                {index > 0 && stop.distanceFromPreviousMeters != null ? (
                  <p className="ai-route-distance"><span>↓</span>{formatHop(stop.distanceFromPreviousMeters)}</p>
                ) : null}
                <div className={`ai-stop-card${stop.image ? " has-photo" : ""}${open ? " is-open" : ""}`}>
                  <button
                    type="button"
                    className="ai-stop-row"
                    aria-expanded={open}
                    aria-controls="ai-place-peek"
                    disabled={disabled}
                    onClick={() => onOpenStop?.(key, stop)}
                  >
                    <em>{String(index + 1).padStart(2, "0")}</em>
                    {stop.image ? <img className="ai-stop-thumb" src={stop.image} alt="" /> : null}
                    <span>
                      <strong>
                        {stop.name}
                        {stop.isSaved ? <span className="ai-stop-saved">저장한 곳</span> : null}
                      </strong>
                      <small>
                        {stop.startTime ? `${stop.startTime} · ${stop.durationMinutes ?? 0}분 · ${stop.meta}` : stop.meta}
                        {stop.rating != null ? ` · ${stop.rating}점${stop.ratingCount ? ` · 후기 ${stop.ratingCount}` : ""}` : ""}
                        {stop.dishes ? ` · ${stop.dishes}` : ""}
                        {stop.openingHours && !stop.meta.includes(stop.openingHours) ? ` · ${stop.openingHours}` : ""}
                      </small>
                      {stop.reason && stop.reason !== stop.meta ? <small className="ai-stop-reason">{stop.reason}</small> : null}
                      <small className="ai-stop-cue">{open ? "미리보기 닫기" : "위치 보기"}</small>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="ai-stop-kakao"
                    onClick={() => openPlaceMiniWindow(kakaoUrl, "kakao")}
                    aria-label={`${stop.name} 카카오맵에서 보기`}
                  >
                    보기
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}
      {chips.length > 0 && (
        <div className={`ai-quick-replies${courseActions ? " is-course-actions" : ""}`} role="group" aria-label="바로 고르기">
          {chips.map(option => {
            const active = selectedChoices.includes(option);
            return (
              <button
                key={option}
                type="button"
                className={active ? "is-selected" : ""}
                disabled={disabled}
                onClick={() => options?.multiple ? onToggle?.(option) : onPick(option)}
              >{option}</button>
            );
          })}
        </div>
      )}
      {options?.multiple && (
        <button type="button" className="ai-choice-submit" disabled={!selectedChoices.length || disabled} onClick={onSubmit}>
          다음
        </button>
      )}
    </article>
  );
}

export function AIPlanEditor({
  kind,
  items,
  onApply,
  onReplace,
  onKeep,
  startDate,
  tasteSeed = null,
}: {
  kind: PlanKind;
  items: PlanItem[];
  onApply: (changes: PlanChange[]) => void;
  onReplace: (next: PlanItem[]) => void;
  onKeep?: (input: CourseKeepInput) => Promise<CourseKeepResult> | CourseKeepResult;
  places?: Place[];
  startDate?: string;
  tasteSeed?: TasteDateSeed | null;
}) {
  const [mode, setMode] = useState<Mode>(kind === "date" ? "generate" : items.length ? "edit" : "generate");
  const [editPrompt, setEditPrompt] = useState(() => items.length <= 1 ? "이 장소에서 여유롭게 머물 수 있도록 체류 시간을 조정해줘." : EDIT_PROMPT);
  const [generatePrompt, setGeneratePrompt] = useState(() => tasteSeed?.prompt ?? "");
  const [phase, setPhase] = useState<"idle" | "loading" | "preview">("idle");
  const [changes, setChanges] = useState<PlanChange[]>([]);
  const [summary, setSummary] = useState("");
  const [selected, setSelected] = useState<boolean[]>([]);
  const [recommendation, setRecommendation] = useState<AIPlannerReply | null>(null);
  const [plannerState, setPlannerState] = useState<AIPlannerState>(() => tasteSeed ? plannerStateFromSeed(tasteSeed) : emptyDateBrief());
  const [conversation, setConversation] = useState<ChatTurn[]>(() => tasteSeed ? [{
    role: "assistant",
    text: tasteSeed.prompt,
    card: {
      headline: tasteSeed.headline,
      lines: tasteSeed.lines,
      suggestions: ["이 조건으로 코스 만들기"],
    },
  }] : []);
  const [choicePrompt, setChoicePrompt] = useState<ChoicePrompt | null>(null);
  const [selectedChoices, setSelectedChoices] = useState<string[]>([]);
  const [peek, setPeek] = useState<{ key: string; stop: AIChatStop } | null>(null);
  const [shownStops, setShownStops] = useState<AIChatStop[]>([]);
  const [pendingLabel, setPendingLabel] = useState("");
  const [error, setError] = useState("");
  const [keepStep, setKeepStep] = useState<KeepStep>("idle");
  const [tripStartDate, setTripStartDate] = useState("");
  const [keeping, setKeeping] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const chatLogRef = useRef<HTMLDivElement>(null);
  const keepChatPinnedRef = useRef(true);
  const requestIdRef = useRef(0);

  const keepDays = courseDayCount(recommendation?.items ?? [], plannerState.nights);

  useEffect(() => {
    const chatLog = chatLogRef.current;
    if (!chatLog || !keepChatPinnedRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      chatLog.scrollTo({ top: chatLog.scrollHeight, behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [conversation, phase, keepStep, tripStartDate]);

  useEffect(() => {
    if (keepStep !== "trip-dates") return;
    const calendar = document.querySelector(".ai-keep-calendar");
    calendar?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [keepStep]);

  useEffect(() => {
    if (!peek) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPeek(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [peek]);

  const chosen = useMemo(
    () => changes.filter((_, index) => selected[index]),
    [changes, selected],
  );
  const routeSummary = useMemo(() => {
    if (!recommendation) return null;
    const distance = recommendation.recommendations.reduce((sum, place) => sum + (place.distanceFromPreviousMeters ?? 0), 0);
    return {
      distance,
    };
  }, [recommendation]);

  function resetKeep() {
    setKeepStep("idle");
    setTripStartDate("");
    setKeeping(false);
  }

  function beginKeep(userText?: string) {
    if (!recommendation?.items.length || keeping) return;
    setPeek(null);
    setChoicePrompt(null);
    setSelectedChoices([]);
    setKeepStep("destination");
    if (!userText && keepStep !== "idle") return;
    setGeneratePrompt("");
    setConversation(current => [
      ...current,
      ...(userText ? [{ role: "user" as const, text: userText }] : []),
      {
        role: "assistant",
        text: "이 코스를 어디에 담을까요?",
        card: {
          headline: "어디에 담을까요?",
          lines: ["하루 데이트로 둘지, 여행 일정으로 둘지 고르면 됩니다."],
          suggestions: [DATE_KEEP_LABEL, TRIP_KEEP_LABEL],
        },
      },
    ]);
  }

  function askTripDates(userText?: string) {
    if (!recommendation?.items.length) return;
    const days = courseDayCount(recommendation.items, plannerState.nights);
    const initial = tripStartDate || startDate || toIsoDate(new Date());
    setTripStartDate(initial);
    setKeepStep("trip-dates");
    setPeek(null);
    setChoicePrompt(null);
    setGeneratePrompt("");
    setConversation(current => [
      ...current,
      ...(userText ? [{ role: "user" as const, text: userText }] : []),
      {
        role: "assistant",
        text: "여행 날짜를 골라 주세요.",
        card: {
          headline: "여행 날짜",
          lines: [`${staySpanLabel(days)} 일정입니다. 캘린더에서 시작일을 고르면 됩니다.`],
        },
      },
    ]);
  }

  async function commitKeep(destination: "date" | "trip", userText?: string) {
    if (!recommendation?.items.length || keeping) return;
    if (destination === "trip" && !(tripStartDate || startDate)) {
      askTripDates(userText);
      return;
    }
    const days = courseDayCount(recommendation.items, plannerState.nights);
    const nextDate = destination === "trip" ? (tripStartDate || startDate || toIsoDate(new Date())) : (startDate || null);
    const title = courseKeepTitle(destination, recommendation.condition.region || plannerState.region || "");
    setKeeping(true);
    setError("");
    setPeek(null);
    if (userText) {
      setConversation(current => [...current, { role: "user", text: userText }]);
    }
    const payload: CourseKeepInput = {
      destination,
      items: recommendation.items,
      startDate: nextDate,
      dayCount: days,
      title,
    };
    const result = onKeep ? await onKeep(payload) : { ok: true as const };
    if (result && "error" in result) {
      setError(result.error);
      setKeeping(false);
      setKeepStep(destination === "trip" ? "trip-dates" : "destination");
      setConversation(current => [...current, { role: "assistant", text: result.error, card: { headline: "담지 못했습니다", lines: [result.error] } }]);
      return;
    }
    if (!onKeep) onReplace(recommendation.items);
    const savedLine = destination === "trip" && nextDate
      ? `${formatKoPicker(nextDate)}${days > 1 ? `부터 ${staySpanLabel(days)}` : ""} 여행 일정에 담았습니다.`
      : "데이트 코스에 담았습니다. 장소나 순서는 이어서 바꿀 수 있습니다.";
    setConversation(current => [
      ...current,
      {
        role: "assistant",
        text: savedLine,
        card: {
          headline: destination === "trip" ? "여행에 담았습니다" : "데이트 코스에 담았습니다",
          lines: [savedLine],
        },
      },
    ]);
    resetKeep();
  }

  function handleKeepIntent(intent: "ask" | "date" | "trip", userText?: string) {
    if (intent === "ask") {
      beginKeep(userText);
      return;
    }
    if (intent === "trip") {
      askTripDates(userText);
      return;
    }
    void commitKeep("date", userText);
  }

  function switchMode(next: Mode) {
    setMode(next);
    setPhase("idle");
    setError("");
    setChanges([]);
    setRecommendation(null);
    setPlannerState(emptyDateBrief());
    setConversation([]);
    setChoicePrompt(null);
    setSelectedChoices([]);
    setPeek(null);
    setShownStops([]);
    resetKeep();
    requestIdRef.current += 1;
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

  async function runGenerate(nextState: AIPlannerState, message: string, displayText?: string) {
    const request = message.trim();
    const intent = recommendation ? keepIntent(request) : null;
    if (intent) {
      handleKeepIntent(intent, displayText || request);
      setGeneratePrompt("");
      return;
    }
    if (keepStep !== "idle") resetKeep();
    const pending = missingSlot(nextState);
    if (!request && pending) {
      setPlannerState(nextState);
      const question = slotQuestion(pending, nextState);
      setConversation(current => [
        ...current,
        ...(displayText ? [{ role: "user" as const, text: displayText }] : []),
        { role: "assistant", text: question.message, card: { headline: "", lines: [question.message] } },
      ]);
      setChoicePrompt(slotPrompt(pending, nextState));
      return;
    }
    const ticket = ++requestIdRef.current;
    setError("");
    setPhase("loading");
    setPendingLabel(pendingLabelFor(request, Boolean(recommendation), nextState));
    setChoicePrompt(null);
    setSelectedChoices([]);
    setPeek(null);
    if (displayText || request) {
      setConversation(current => [...current, { role: "user", text: displayText || request }]);
    }
    setGeneratePrompt("");
    if (composerRef.current) composerRef.current.style.height = "38px";
    const nextTurns = [
      ...conversation,
      ...(displayText || request ? [{ role: "user" as const, text: displayText || request }] : []),
    ].slice(-8);
    try {
      const result = await recommendDatePlan({
        currentPlan: recommendation,
        message: request,
        previousPlaceNames: recommendation?.recommendations.map(place => place.name),
        previousStops: recommendation?.recommendations.map(place => ({ name: place.name, category: place.category })),
        courseStops: recommendation?.card.stops,
        shownStops,
        previousState: nextState,
        dateLabel: startDate || undefined,
        conversation: nextTurns.map(turn => ({ role: turn.role, text: turn.text })),
      });
      if (ticket !== requestIdRef.current) return;
      if ("error" in result) {
        const safeError = /^false\b/i.test(result.error)
          ? "조건에 맞는 장소를 충분히 찾지 못했습니다. 가고 싶은 동네를 다시 말해 주세요."
          : result.error;
        setConversation(current => [...current, { role: "assistant", text: safeError, card: { headline: "장소를 찾지 못했습니다", lines: [safeError] } }]);
        setPlannerState(nextState);
        return;
      }
      setPlannerState(result.state);
      if (result.status === "clarification") {
        setConversation(current => [...current, { role: "assistant", text: result.message, card: result.card }]);
        setChoicePrompt({ options: result.options, multiple: result.multiple, kind: result.slot });
        return;
      }
      if (result.status === "chat") {
        setConversation(current => [...current, { role: "assistant", text: result.message, card: result.card }]);
        if (result.card.stops?.length) setShownStops(result.card.stops);
        if (result.slot && result.options?.length) {
          setChoicePrompt({ options: result.options, multiple: Boolean(result.multiple), kind: result.slot });
        }
        return;
      }
      setRecommendation(result);
      resetKeep();
      setConversation(current => [
        ...current,
        { role: "assistant", text: result.message, card: { ...result.card, followUp: undefined } },
      ]);
    } catch {
      if (ticket !== requestIdRef.current) return;
      const text = "답변을 가져오지 못했어요. 잠시 후 다시 보내 주세요.";
      setConversation(current => [...current, { role: "assistant", text, card: { headline: "", lines: [text] } }]);
      setPlannerState(nextState);
      setGeneratePrompt(request || displayText || "");
    } finally {
      if (ticket === requestIdRef.current) setPhase("idle");
    }
  }

  function pickQuick(label: string) {
    if (phase === "loading" || keeping) return;
    const intent = recommendation ? keepIntent(label) : null;
    if (intent) {
      handleKeepIntent(intent, label);
      return;
    }
    if (choicePrompt && choicePrompt.options.includes(label) && !choicePrompt.multiple) {
      const next = applySlot(choicePrompt.kind, [label], plannerState);
      setPlannerState(next);
      void runGenerate(next, "", slotUserText(choicePrompt.kind, [label]));
      return;
    }
    void runGenerate(plannerState, label, label);
  }

  function submitChoices() {
    if (!choicePrompt || !selectedChoices.length) return;
    const next = applySlot(choicePrompt.kind, selectedChoices, plannerState);
    const slot = missingSlot(next);
    setPlannerState(next);
    const userText = slotUserText(choicePrompt.kind, selectedChoices);
    if (slot) {
      setConversation(current => [
        ...current,
        { role: "user", text: userText },
        { role: "assistant", text: slotQuestion(slot, next).message },
      ]);
      setChoicePrompt(slotPrompt(slot, next));
      setSelectedChoices([]);
      return;
    }
    void runGenerate(next, "", userText);
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
          <p>{mode === "generate" ? "AI로 완성하는 우리만의 하루" : "말 한마디로 더 여유로운 일정"}</p>
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
        <div className="ai-chat-thread">
          <div
            className="ai-chat-log"
            aria-live="polite"
            ref={chatLogRef}
            onScroll={event => {
              const element = event.currentTarget;
              keepChatPinnedRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 36;
            }}
          >
            {conversation.length === 0 && (
              <AssistantCard
                card={WELCOME_CARD}
                text=""
                selectedChoices={[]}
                disabled={phase === "loading"}
                onPick={pickQuick}
              />
            )}
            {conversation.map((message, index) => {
              const last = index === conversation.length - 1;
              if (message.role === "user") {
                return <p key={`user-${index}`} className="is-user">{message.text}</p>;
              }
              return (
                <AssistantCard
                  key={`assistant-${index}`}
                  card={message.card}
                  text={message.text}
                  options={last ? choicePrompt : undefined}
                  selectedChoices={last ? selectedChoices : []}
                  disabled={phase === "loading" || keeping}
                  openStopKey={peek?.key}
                  onOpenStop={(key, stop) => setPeek(current => current?.key === key ? null : { key, stop })}
                  onPick={pickQuick}
                  onToggle={label => setSelectedChoices(current => current.includes(label) ? current.filter(item => item !== label) : [...current, label])}
                  onSubmit={submitChoices}
                />
              );
            })}
            {phase === "loading" && (
              <article className="ai-bubble is-assistant is-typing" aria-label="답변하는 중">
                <span><i /><i /><i /></span>
                <p>{pendingLabel || "근처 장소를 찾고 동선을 맞추는 중입니다."}</p>
              </article>
            )}
          </div>
          {peek ? <CoursePlacePeek key={peek.key} stop={peek.stop} onClose={() => setPeek(null)} /> : null}
          {recommendation ? (
            <div className="ai-course-preview">
              {keepStep !== "trip-dates" && (
                <div className="ai-route-map">
                  <PlanMap items={recommendation.items} dayLabel={`${recommendation.condition.region} 동선`} />
                  <div className="ai-map-legend">
                    <span><i /> 추천 순서</span>
                    <b>추천 순서 · 직선거리</b>
                  </div>
                </div>
              )}
              <div className={`ai-apply-bar${keepStep === "idle" ? "" : " is-keep"}`}>
                {keepStep === "trip-dates" ? (
                  <div className="ai-keep-calendar">
                    <div>
                      <span>{staySpanLabel(keepDays)} · 시작일을 고르세요</span>
                      <small>
                        {tripStartDate
                          ? keepDays > 1
                            ? `${formatKoPicker(tripStartDate)} ~ ${formatKoPicker(tripEndDate(tripStartDate, keepDays))}`
                            : formatKoPicker(tripStartDate)
                          : "캘린더에서 날짜를 고르면 여행 일정에 붙습니다."}
                      </small>
                    </div>
                    <CalendarMonth
                      key={tripStartDate.slice(0, 7) || "trip-dates"}
                      value={tripStartDate}
                      dayCount={keepDays}
                      onSelect={setTripStartDate}
                    />
                    <div className="ai-keep-actions">
                      <button type="button" className="is-secondary" disabled={keeping} onClick={() => beginKeep()}>뒤로</button>
                      <button type="button" disabled={!tripStartDate || keeping} onClick={() => void commitKeep("trip")}>
                        {keeping ? "담는 중..." : "이 날짜로 여행에 담기"}
                      </button>
                    </div>
                  </div>
                ) : keepStep === "destination" ? (
                  <>
                    <div>
                      <span>어디에 담을까요?</span>
                      <small>데이트는 하루 코스, 여행은 날짜를 붙인 일정입니다.</small>
                    </div>
                    <div className="ai-keep-actions">
                      <button type="button" disabled={keeping} onClick={() => void commitKeep("date")}>{DATE_KEEP_LABEL}</button>
                      <button type="button" disabled={keeping} onClick={() => askTripDates()}>{TRIP_KEEP_LABEL}</button>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <span>
                        {recommendation.recommendations.length}곳
                        {routeSummary ? ` · 직선 ${formatRouteLength(routeSummary.distance)}` : ""}
                        {keepDays > 1 ? ` · ${staySpanLabel(keepDays)}` : ""}
                      </span>
                      <small>담을 때 데이트 코스와 여행 중 고를 수 있습니다.</small>
                    </div>
                    <button type="button" disabled={!recommendation.items.length} onClick={() => beginKeep()}>
                      이 코스 담기
                    </button>
                  </>
                )}
              </div>
            </div>
          ) : null}
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
                  if (phase !== "loading" && !keeping) void runGenerate(plannerState, generatePrompt);
                }
              }}
              rows={1}
              aria-label="AI 플래너에게 메시지"
              placeholder={keepStep === "destination" ? "데이트 코스 또는 여행" : keepStep === "trip-dates" ? "날짜는 캘린더에서 고르세요" : recommendation ? COURSE_PLACEHOLDER : GENERATE_PLACEHOLDER}
              disabled={phase === "loading" || keeping}
            />
            <button type="button" onClick={() => void runGenerate(plannerState, generatePrompt)} disabled={phase === "loading" || keeping || !generatePrompt.trim()} aria-label="메시지 보내기">
              {phase === "loading" ? <i className="ai-spinner" /> : <span>↑</span>}
            </button>
            <small>Enter 전송 · Shift + Enter 줄바꿈</small>
          </div>
        </div>
      )}

      {error && mode === "edit" && <p className="form-error" role="alert">{error}</p>}

      {phase === "loading" && mode === "edit" && (
        <div className="ai-progress">
          <div className="ai-search-orbit"><i /><i /><i /></div>
          <div><span>일정을 읽고 있어요</span><p>요청에 맞는 조정을 준비하고 있어요.</p></div>
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

      <p className="form-hint ai-disclaimer">
        {mode === "generate"
          ? "동선은 직선거리 기준입니다. 담을 때 데이트 코스와 여행 중 고를 수 있습니다."
          : "이미 담긴 일정만 삭제하거나 체류 시간을 조정합니다."}
      </p>
    </div>
  );
}

"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { proposePlanEdits, recommendDatePlanWithSession } from "../actions";
import type { SessionCandidateContext } from "../sessionCandidates";
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
import { CandidateExplorationPanel } from "./CandidateExplorationPanel";
import { exploreCandidateGroups, prepareCandidateExploration,
  updateCandidateExplorationChoices } from "../candidateExplorationActions";
import type { CandidateExplorationPreferences, CandidateGroup, ExplorationActivity,
  ExplorationCard, ItineraryPlanningInput } from "../candidateExploration";
import { refinementGroupForMessage } from "../candidateExploration";
import type { ExperiencePlan } from "../experiencePlan";
import type { ResearchPlan } from "../researchPlan";
import { selectedAreas } from "../dateBrief";
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
const GENERATE_PLACEHOLDER = "동네와 하고 싶은 일을 말해 주세요";
const COURSE_PLACEHOLDER = "예: 식당 변경 해줘 · 1번 주차 돼?";
const WELCOME_CARD: AIChatCard = {
  headline: "어떤 데이트를 계획할까요?",
  lines: ["지역과 원하는 경험을 말해 주세요. 장소 후보를 먼저 고른 뒤 일정을 만들 수 있어요."],
  suggestions: ["왕십리 데이트 코스", "성수 영화·카페 코스", "을지로 공연·저녁 코스"],
};
const TRIP_WELCOME_CARD: AIChatCard = {
  headline: "어디로 여행을 떠나시나요?",
  lines: ["여행 지역과 기간을 알려 주세요. 아직 기간을 정하지 않았다면 함께 선택할 수 있어요."],
  suggestions: ["부산 여행", "제주 1박2일 여행", "강릉 당일치기"],
};

type KeepStep = "idle" | "destination" | "trip-dates";

function stopKakaoUrl(stop: AIChatStop) {
  const raw = stop.mapUrl?.trim();
  if (raw) return raw.replace(/^http:\/\//, "https://");
  return kakaoPlaceUrl(stop.name, stop.coordinates);
}

function formatHop(meters: number | null | undefined, basis: AIChatCard["routeBasis"] = "straight_line") {
  if (meters == null) return "";
  const label = basis === "walking" ? "도보 경로" : "직선";
  if (meters < 1000) return `${label} ${meters}m`;
  return `${label} ${(meters / 1000).toFixed(1)}km`;
}

function formatRouteLength(meters: number) {
  if (meters < 1000) return `${meters}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

type ChatTurn = {
  role: "user" | "assistant";
  text: string;
  card?: AIChatCard;
  explorationAnchorId?: string;
  progressive?: boolean;
};

type Mode = "edit" | "generate";
type ChoicePrompt = { options: string[]; multiple: boolean; kind: DateIntakeSlot };

function slotPrompt(slot: DateIntakeSlot, state?: AIPlannerState): ChoicePrompt {
  const question = slotQuestion(slot, state);
  return { options: question.options, multiple: question.multiple, kind: slot };
}

function applySlot(kind: DateIntakeSlot, choices: string[], state: AIPlannerState): AIPlannerState {
  if (kind === "activity") return { ...withActivities(state, choices.filter(choice => choice !== "추천에 맡기기")), intakeFocusDone: true };
  if (kind === "area") return withAreas(state, choices);
  if (kind === "scope") return withAreaScope(state, choices[0] ?? "");
  if (kind === "span") return withStayKind(state, choices[0] ?? "");
  if (kind === "time") return withTimeWindow(state, choices[0] ?? "");
  if (kind === "cuisine") return withCuisine(state, choices[0] ?? "");
  return { ...state, indoorPlay: choices[0] ?? null, pendingSlot: null };
}

function slotUserText(kind: DateIntakeSlot, choices: string[]) {
  if (kind === "activity") return choices.includes("추천에 맡기기") ? "데이트 취향은 추천에 맡길게" : `${choices.join(", ")} 중심으로 데이트하고 싶어`;
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
  progressive = false,
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
  progressive?: boolean;
}) {
  const lines = (card?.lines?.length ? card.lines : text ? [text] : [])
    .flatMap(line => line.split(/\n\s*\n/).map(part => part.trim()).filter(Boolean));
  const totalCharacters = lines.reduce((sum, line) => sum + Array.from(line).length, 0);
  const totalStops = card?.stops?.length ?? 0;
  const [visibleCharacters, setVisibleCharacters] = useState(progressive ? 0 : Infinity);
  const [visibleStops, setVisibleStops] = useState(progressive ? 0 : Infinity);
  const newestStopRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (!progressive || (visibleCharacters >= totalCharacters && visibleStops >= totalStops)) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setVisibleCharacters(totalCharacters);
      setVisibleStops(totalStops);
      return;
    }
    const timer = window.setTimeout(() => {
      if (visibleCharacters < totalCharacters) setVisibleCharacters(count => Math.min(totalCharacters, count + 9));
      else setVisibleStops(count => Math.min(totalStops, count + 1));
    }, visibleCharacters < totalCharacters ? 28 : 260);
    return () => window.clearTimeout(timer);
  }, [progressive, totalCharacters, totalStops, visibleCharacters, visibleStops]);
  useEffect(() => {
    if (!progressive || visibleStops === 0) return;
    const frame = window.requestAnimationFrame(() => newestStopRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
    return () => window.cancelAnimationFrame(frame);
  }, [progressive, visibleStops]);
  let remainingCharacters = visibleCharacters;
  const displayedLines = lines.map(line => {
    const characters = Array.from(line);
    const displayed = progressive ? characters.slice(0, Math.max(0, remainingCharacters)).join("") : line;
    remainingCharacters -= characters.length;
    return displayed;
  }).filter(Boolean);
  const writing = progressive && (visibleCharacters < totalCharacters || visibleStops < totalStops);
  const chips = options?.options?.length ? options.options : (card?.suggestions ?? []);
  const courseActions = chips.length > 0 && chips.every(chip => isCourseQuickAction(chip));
  return (
    <article className="ai-bubble is-assistant">
      {card?.headline ? <b>{card.headline}</b> : null}
      {displayedLines.map((line, index) => <p key={index} className="ai-bubble-paragraph">{line}</p>)}
      {!writing && card?.sources?.length ? (
        <div className="ai-answer-sources" aria-label="답변 출처">
          {card.sources.map(source => (
            <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">
              출처 · {source.label} ↗
            </a>
          ))}
        </div>
      ) : null}
      {card?.stops?.length && visibleStops > 0 ? (
        <ol className="ai-bubble-stops">
          {card.stops.slice(0, visibleStops).map((stop, index) => {
            const key = `${stop.name}-${index}`;
            const open = openStopKey === key;
            const multiDay = card.stops?.some(item => (item.dayIndex ?? 0) > 0) ?? false;
            const showDay = multiDay && (index === 0 || (card.stops?.[index - 1]?.dayIndex ?? 0) !== (stop.dayIndex ?? 0));
            const dayOrder = card.stops!.slice(0, index + 1)
              .filter(item => (item.dayIndex ?? 0) === (stop.dayIndex ?? 0)).length;
            const kakaoUrl = stopKakaoUrl(stop);
            return (
              <li key={key} ref={index === Math.min(visibleStops, totalStops) - 1 ? newestStopRef : undefined}>
                {showDay ? <p className="ai-stop-day">{(stop.dayIndex ?? 0) + 1}일차</p> : null}
                {!showDay && index > 0 && stop.distanceFromPreviousMeters != null ? (
                  <p className="ai-route-distance"><span>↓</span>{formatHop(stop.distanceFromPreviousMeters, card.routeBasis)}</p>
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
                    <em>{String(dayOrder).padStart(2, "0")}</em>
                    {stop.image ? <img className="ai-stop-thumb" src={stop.image} alt="" /> : null}
                    <span>
                      <strong>
                        {stop.name}
                        {stop.isSaved ? <span className="ai-stop-saved">저장한 곳</span> : null}
                      </strong>
                      <small className="ai-stop-meta">{stop.meta}</small>
                      {stop.startTime ? <small className="ai-stop-time">{stop.startTime}{stop.durationMinutes ? ` · 약 ${stop.durationMinutes}분` : ""}</small> : null}
                      {stop.reason && stop.reason !== stop.meta ? <small className="ai-stop-reason">{stop.reason}</small> : null}
                      <small className="ai-stop-cue">{open ? "장소 정보 닫기" : "장소 정보 보기"}</small>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="ai-stop-kakao"
                    onClick={() => openPlaceMiniWindow(kakaoUrl, "kakao")}
                    aria-label={`${stop.name} 카카오맵에서 보기`}
                  >
                    지도 ↗
                  </button>
                </div>
                {stop.factSourceUrl && sourceHost(stop.factSourceUrl) ? (
                  <a className="ai-stop-evidence-link" href={stop.factSourceUrl} target="_blank" rel="noopener noreferrer">
                    추천 근거 · {sourceHost(stop.factSourceUrl)} ↗
                  </a>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : null}
      {writing && <span className="ai-writing-indicator" role="status">답변을 작성하고 있어요<span aria-hidden="true">▍</span></span>}
      {!writing && chips.length > 0 && (
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
  candidateExplorationActive = false,
}: {
  kind: PlanKind;
  items: PlanItem[];
  onApply: (changes: PlanChange[]) => void;
  onReplace: (next: PlanItem[]) => void;
  onKeep?: (input: CourseKeepInput) => Promise<CourseKeepResult> | CourseKeepResult;
  places?: Place[];
  startDate?: string;
  tasteSeed?: TasteDateSeed | null;
  candidateExplorationActive?: boolean;
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
  const [planningSessionId, setPlanningSessionId] = useState(() => crypto.randomUUID());
  const sessionCandidatesRef = useRef<SessionCandidateContext | null>(null);
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
  const [exploration, setExploration] = useState<{ request: string; anchorId: string;
    preferences: CandidateExplorationPreferences; groups: CandidateGroup[] | null;
    experiencePlan: ExperiencePlan | null; researchPlan: ResearchPlan | null } | null>(null);
  const [explorationSelectedIds, setExplorationSelectedIds] = useState<string[]>([]);
  const [explorationSelectedCards, setExplorationSelectedCards] = useState<ExplorationCard[]>([]);
  const [explorationRejectedIds, setExplorationRejectedIds] = useState<string[]>([]);
  const [activeExplorationGroup, setActiveExplorationGroup] = useState<ExplorationActivity | null>(null);
  const [explorationBusy, setExplorationBusy] = useState(false);
  const [pendingExplorationRequest, setPendingExplorationRequest] = useState("");
  const [pendingLabel, setPendingLabel] = useState("");
  const [loadingSeconds, setLoadingSeconds] = useState(0);
  const [error, setError] = useState("");
  const [keepStep, setKeepStep] = useState<KeepStep>("idle");
  const [tripStartDate, setTripStartDate] = useState("");
  const [keeping, setKeeping] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const chatLogRef = useRef<HTMLDivElement>(null);
  const explorationAnchorRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef(0);

  const keepDays = courseDayCount(recommendation?.items ?? [], plannerState.nights);

  useEffect(() => {
    if (phase !== "loading" && !explorationBusy) return;
    const timer = window.setInterval(() => setLoadingSeconds(seconds => seconds + 1), 1000);
    return () => window.clearInterval(timer);
  }, [phase, explorationBusy]);

  useEffect(() => {
    const last = [...(chatLogRef.current?.children ?? [])]
      .filter(element => !element.classList.contains("ai-exploration-turn")).at(-1) as HTMLElement | undefined;
    if (!last) return;
    const frame = window.requestAnimationFrame(() => {
      last.scrollIntoView({ block: conversation.at(-1)?.role === "assistant" ? "start" : "end", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [conversation, phase, keepStep, tripStartDate]);

  useEffect(() => {
    if (!exploration) return;
    const frame = window.requestAnimationFrame(() => {
      explorationAnchorRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [exploration?.anchorId, exploration?.groups]);

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
    setPlanningSessionId(crypto.randomUUID());
    sessionCandidatesRef.current = null;
    setConversation([]);
    setChoicePrompt(null);
    setSelectedChoices([]);
    setPeek(null);
    setShownStops([]);
    setExploration(null);
    setExplorationSelectedIds([]);
    setExplorationSelectedCards([]);
    setExplorationRejectedIds([]);
    setActiveExplorationGroup(null);
    setPendingExplorationRequest("");
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

  async function searchExploration(groupId?: ExplorationActivity, refinement?: string) {
    if (!exploration || explorationBusy) return;
    setExplorationBusy(true);
    setLoadingSeconds(0);
    try {
      const response = await exploreCandidateGroups({ message: exploration.request, state: plannerState,
        preferences: exploration.preferences, planningSessionId, sessionCandidates: sessionCandidatesRef.current,
        experiencePlan: exploration.experiencePlan, researchPlan: exploration.researchPlan,
        groupId, refinement, selectedIds: explorationSelectedIds, rejectedIds: explorationRejectedIds });
      if ("error" in response) throw new Error(response.error);
      sessionCandidatesRef.current = response.sessionCandidates;
      setExploration(current => current ? { ...current, experiencePlan: response.experiencePlan,
        researchPlan: response.researchPlan,
        groups: groupId && current.groups ? current.groups.map(group =>
          group.id === groupId ? response.groups[0] ?? group : group) : response.groups } : current);
    } catch {
      setConversation(current => [...current, { role: "assistant", text: "후보를 불러오지 못했어요. 다시 시도해 주세요." }]);
    } finally { setExplorationBusy(false); }
  }

  async function beginExploration(message: string, nextState: AIPlannerState) {
    if (explorationBusy) return;
    setExplorationBusy(true);
    setLoadingSeconds(0);
    setConversation(current => [...current, { role: "user", text: message }]);
    try {
      const combined = pendingExplorationRequest ? `${pendingExplorationRequest} ${message}` : message;
      const prepared = await prepareCandidateExploration({ message: combined, previousState: nextState });
      if ("error" in prepared) throw new Error(prepared.error);
      setPlannerState(prepared.state);
      if (prepared.needsArea) {
        setPendingExplorationRequest(combined);
        setConversation(current => [...current, { role: "assistant", text: "어느 지역으로 갈까요? 여행할 지역이나 동네를 알려 주세요." }]);
        return;
      }
      if (prepared.needsSpan) {
        setPendingExplorationRequest(combined);
        setConversation(current => [...current, { role: "assistant", text: "며칠 동안 여행하시나요? 당일치기, 1박 2일, 2박 3일 중 골라 주세요.",
          card: { headline: "여행 기간을 알려 주세요", lines: ["당일치기, 1박 2일, 2박 3일 중 하나를 고르거나 직접 입력해 주세요."],
            suggestions: ["당일치기", "1박2일", "2박3일"] } }]);
        return;
      }
      setPendingExplorationRequest("");
      const anchorId = crypto.randomUUID();
      setExploration({ request: combined, anchorId, preferences: prepared.preferences, groups: null,
        experiencePlan: null, researchPlan: null });
      setActiveExplorationGroup(null);
      const area = selectedAreas(prepared.state)[0] ?? "이 지역";
      const span = prepared.state.stayKind === "overnight"
        ? `${prepared.state.nights}박 ${prepared.state.nights + 1}일` : prepared.state.stayKind === "daytrip" ? "당일치기" : "데이트";
      setConversation(current => [...current, { role: "assistant",
        text: span === "데이트"
          ? `${area}에서 데이트할 장소를 함께 골라볼게요. 원하는 종류를 선택하면 후보를 찾아드릴게요.`
          : `${area} ${span} 여행이군요. 원하는 장소 종류를 선택하면 일정에 맞는 후보를 찾아드릴게요.`,
        explorationAnchorId: anchorId }]);
    } catch {
      setConversation(current => [...current, { role: "assistant", text: "요청을 이해하지 못했어요. 지역과 기간을 다시 알려 주세요." }]);
    } finally { setExplorationBusy(false); setGeneratePrompt(""); }
  }

  async function planSelectedCandidates() {
    if (!exploration?.groups || !explorationSelectedIds.length || explorationBusy) return;
    setExplorationBusy(true);
    setLoadingSeconds(0);
    try {
      const verified = await updateCandidateExplorationChoices({ planningSessionId,
        sessionCandidates: sessionCandidatesRef.current,
        selectedIds: explorationSelectedIds, rejectedIds: explorationRejectedIds });
      if (!verified) throw new Error("unverified_session");
      sessionCandidatesRef.current = verified;
      const planningInput: ItineraryPlanningInput = { experiencePlan: exploration.experiencePlan,
        researchPlan: exploration.researchPlan!, selectedCandidateIds: [...explorationSelectedIds],
        rejectedCandidateIds: [...explorationRejectedIds], candidatePool: verified };
      // Until P4, the existing itinerary path resolves these verified selections
      // as required anchors; the contract above remains available to P4.
      const state = { ...plannerState, requiredPlaces: verified.records
        .filter(row => planningInput.selectedCandidateIds.includes(row.candidateId)).map(row => row.name) };
      await runGenerate(state, `${exploration.request}\n선택한 장소를 포함해서 일정 짜줘`, "선택한 장소로 일정 짜기",
        planningInput.selectedCandidateIds);
    } catch {
      setConversation(current => [...current, { role: "assistant",
        text: "선택한 장소를 확인하지 못했어요. 다시 선택하거나 잠시 후 시도해 주세요." }]);
    } finally { setExplorationBusy(false); }
  }

  async function runGenerate(nextState: AIPlannerState, message: string, displayText?: string,
    selectedCandidateIds?: string[]) {
    const request = message.trim();
    if (candidateExplorationActive && !selectedCandidateIds && !recommendation) {
      if (exploration?.groups && request) {
        const groupId = refinementGroupForMessage(exploration.groups, request, activeExplorationGroup);
        if (groupId) {
          const anchorId = crypto.randomUUID();
          setExploration(current => current ? { ...current, anchorId } : current);
          setConversation(current => [...current, { role: "user", text: request, explorationAnchorId: anchorId }]);
          await searchExploration(groupId, request);
          setGeneratePrompt("");
          return;
        }
        setConversation(current => [...current, { role: "user", text: request },
          { role: "assistant", text: "어느 종류의 장소를 더 찾아볼까요? 카페나 맛집처럼 알려 주세요." }]);
        setGeneratePrompt("");
        return;
      }
      if (exploration && !exploration.groups) {
        if (!request) return;
        const anchorId = crypto.randomUUID();
        setExploration(current => current ? { ...current, anchorId, preferences: {
          ...current.preferences,
          additionalDetails: [current.preferences.additionalDetails, request].filter(Boolean).join(" ").slice(0, 160),
          provenance: { ...current.preferences.provenance, additionalDetails: "explicit_text" },
        } } : current);
        setConversation(current => [...current, { role: "user", text: request },
          { role: "assistant", text: "추가 조건을 반영했어요. 원하는 장소 종류를 고른 뒤 ‘선택 완료 · 장소 찾기’를 눌러 주세요.",
            explorationAnchorId: anchorId }]);
        setGeneratePrompt("");
        return;
      }
      if (!exploration && request) { await beginExploration(request, nextState); return; }
    }
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
    setLoadingSeconds(0);
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
      const response = await recommendDatePlanWithSession({
        currentPlan: recommendation,
        message: request,
        previousPlaceNames: recommendation?.recommendations.map(place => place.name),
        previousStops: recommendation?.recommendations.map(place => ({ name: place.name, category: place.category, activitySlot: place.activitySlot })),
        courseStops: recommendation?.card.stops,
        shownStops,
        previousState: nextState,
        dateLabel: startDate || undefined,
        conversation: nextTurns.map(turn => ({ role: turn.role, text: turn.text })),
        planningSessionId, sessionCandidates: sessionCandidatesRef.current,
        selectedCandidateIds,
      });
      if (ticket !== requestIdRef.current) return;
      const result = response.result;
      sessionCandidatesRef.current = response.sessionCandidates;
      if ("error" in result) {
        const safeError = /^false\b/i.test(result.error)
          ? "조건에 맞는 장소를 충분히 찾지 못했습니다. 가고 싶은 동네를 다시 말해 주세요."
          : result.error;
        setConversation(current => [...current, { role: "assistant", text: safeError, card: { headline: "장소를 찾지 못했습니다", lines: [safeError] } }]);
        setPlannerState(plannerState);
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
      setShownStops([]);
      resetKeep();
      setConversation(current => [
        ...current,
        { role: "assistant", text: result.message, card: { ...result.card, followUp: undefined }, progressive: true },
      ]);
    } catch {
      if (ticket !== requestIdRef.current) return;
      const text = "답변을 가져오지 못했어요. 잠시 후 다시 보내 주세요.";
      setConversation(current => [...current, { role: "assistant", text, card: { headline: "", lines: [text] } }]);
      setPlannerState(plannerState);
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

  const explorationPanel = exploration && <div className="ai-exploration-turn" ref={explorationAnchorRef}><CandidateExplorationPanel area={selectedAreas(plannerState)[0] ?? "지역 미정"}
            nights={plannerState.nights} preferences={exploration.preferences}
            onPreferencesChange={preferences => setExploration(current => current
              ? { ...current, preferences, experiencePlan: null, researchPlan: null } : current)}
            groups={exploration.groups} selectedIds={explorationSelectedIds}
            selectedCards={explorationSelectedCards}
            rejectedIds={explorationRejectedIds} busy={explorationBusy}
            planned={Boolean(recommendation)}
            onSearch={() => void searchExploration()}
            onSelect={card => { setActiveExplorationGroup(exploration.groups?.find(group =>
              group.cards.some(item => item.candidateId === card.candidateId))?.id ?? activeExplorationGroup);
              setExplorationSelectedIds(current => current.includes(card.candidateId)
              ? current.filter(id => id !== card.candidateId) : [...current, card.candidateId]);
              setExplorationSelectedCards(current => current.some(item => item.candidateId === card.candidateId)
                ? current.filter(item => item.candidateId !== card.candidateId) : [...current, card]); }}
            onReject={card => { setActiveExplorationGroup(exploration.groups?.find(group =>
              group.cards.some(item => item.candidateId === card.candidateId))?.id ?? activeExplorationGroup);
              setExplorationRejectedIds(current => [...new Set([...current, card.candidateId])]);
              setExplorationSelectedIds(current => current.filter(id => id !== card.candidateId));
              setExplorationSelectedCards(current => current.filter(item => item.candidateId !== card.candidateId)); }}
            onMore={id => { setActiveExplorationGroup(id); void searchExploration(id); }}
            onRefine={(id, text) => { setActiveExplorationGroup(id); void searchExploration(id, text); }}
            onDetail={card => { setActiveExplorationGroup(exploration.groups?.find(group =>
              group.cards.some(item => item.candidateId === card.candidateId))?.id ?? activeExplorationGroup);
              setPeek({ key: card.candidateId, stop: {
              name: card.name, meta: `${card.area} · ${card.category}`, reason: card.reason,
              image: card.image, mapUrl: card.mapUrl, address: card.address,
              factSourceUrl: card.evidenceUrls[0],
            } }); }}
            onPlan={() => void planSelectedCandidates()}
            onEdit={() => setExploration(current => current ? { ...current, groups: null,
              experiencePlan: null, researchPlan: null } : current)} /></div>;

  return (
    <div className="ai-editor">
      <header className="ai-editor-head">
        <div className="ai-brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M12 2l1.35 5.1L18 9l-4.65 1.9L12 16l-1.35-5.1L6 9l4.65-1.9L12 2Z"/><path d="M19 15l.7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7L19 15Z"/></svg>
        </div>
        <div>
          <span className="eyebrow">ONLY US AI</span>
          <h2>{mode === "generate" ? kind === "trip" ? "여행 플래너" : "데이트 플래너" : "일정 다듬기"}</h2>
          <p>{mode === "generate" ? kind === "trip" ? "여행 기간에 맞춰 장소부터 일정까지" : "장소부터 고르는 우리만의 하루" : "원하는 부분만 바꿔 보세요"}</p>
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
          >
            {conversation.length === 0 && (
              <AssistantCard
                card={kind === "trip" ? TRIP_WELCOME_CARD : WELCOME_CARD}
                text=""
                selectedChoices={[]}
                disabled={phase === "loading"}
                onPick={pickQuick}
              />
            )}
            {conversation.map((message, index) => {
              const last = index === conversation.length - 1;
              if (message.role === "user") {
                return <Fragment key={`user-${index}`}><p className="is-user">{message.text}</p>
                  {message.explorationAnchorId === exploration?.anchorId && explorationPanel}</Fragment>;
              }
              return (
                <Fragment key={`assistant-${index}`}>
                <AssistantCard
                  card={message.card}
                  text={message.text}
                  options={last ? choicePrompt : undefined}
                  selectedChoices={last ? selectedChoices : []}
                  disabled={phase === "loading" || keeping}
                  openStopKey={peek?.key}
                  onOpenStop={(key, stop) => setPeek(current => current?.key === key ? null : { key, stop })}
                  onPick={pickQuick}
                  onToggle={label => setSelectedChoices(current => label === "추천에 맡기기" ? [label] : current.includes(label) ? current.filter(item => item !== label) : [...current.filter(item => item !== "추천에 맡기기"), label])}
                  onSubmit={submitChoices}
                  progressive={message.progressive}
                />
                {message.explorationAnchorId === exploration?.anchorId && explorationPanel}
                </Fragment>
              );
            })}
            {(phase === "loading" || explorationBusy) && (
              <article className="ai-bubble is-assistant is-assembling" aria-label="답변 준비 중">
                <div className="ai-assembling-status" role="status"><span className="ai-assembling-orbit" aria-hidden="true" />
                  <div><b>{phase === "loading" ? pendingLabel || "답변을 준비하고 있어요"
                    : exploration?.groups ? "장소 후보를 확인하고 있어요" : "요청을 확인하고 있어요"}</b>
                    <small>{loadingSeconds < 8 ? "장소와 일정 정보를 확인하는 중입니다." : `계속 확인하고 있어요 · ${loadingSeconds}초`}</small></div>
                </div>
                <div className="ai-answer-skeleton" aria-hidden="true">
                  <span className="is-heading" /><span className="is-line" /><span className="is-line is-short" />
                  <div><span /><span /></div>
                </div>
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
                    <b>{recommendation.design?.routeBasis === "walking" ? "추천 순서 · 도보 경로 (OSRM/OSM)" : "추천 순서 · 직선거리"}</b>
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
                        {routeSummary ? ` · ${recommendation.design?.routeBasis === "walking" ? "도보 경로" : "직선"} ${formatRouteLength(routeSummary.distance)}` : ""}
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
          ? recommendation?.design?.routeBasis === "walking"
            ? "도보 경로는 OSRM/OpenStreetMap 자료 기준입니다. 실제 통행 상황은 달라질 수 있습니다."
            : "동선은 직선거리 기준입니다. 담을 때 데이트 코스와 여행 중 고를 수 있습니다."
          : "이미 담긴 일정만 삭제하거나 체류 시간을 조정합니다."}
      </p>
    </div>
  );
}

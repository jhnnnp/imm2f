import type { AIPlannerReply, AIPlannerState, AIPlannerResult } from "@/features/planning/types/plan";
import type { ChatRoute } from "./chatRoute";
import { assumedTimeWindow, selectedAreas } from "./dateBrief";
import { clockMinutes, fitSchedule, formatClock, scheduleGapMinutes } from "./schedule";
import { distanceMeters } from "@/features/places/geo";

/** Apply a conversational edit to the existing entities, without another venue search. */
export function editCurrentCourse(plan: AIPlannerReply, edit: NonNullable<ChatRoute["edit"]>, state: AIPlannerState,
  options?: { targetItemId?: string; targetStartTime?: string; verifiedTravelMinutes?: number[] }): AIPlannerResult {
  const validIndices = Array.isArray(edit.indices) && edit.indices.every(index => Number.isInteger(index) && index >= 1 && index <= plan.items.length)
    && new Set(edit.indices).size === edit.indices.length;
  if (!validIndices || (edit.kind === "remove" && !edit.indices.length)
    || (edit.kind === "reorder" && edit.indices.length !== plan.items.length)
    || plan.recommendations.length !== plan.items.length) {
    const message = "변경할 장소를 정확히 확인하지 못했어요. 기존 코스는 유지했어요. 표시된 장소 번호와 원하는 변경을 다시 알려 주세요.";
    return { status: "chat", message, card: { headline: "", lines: [message] }, state: plan.state };
  }
  const indexed = plan.items.map((item, index) => ({ item, recommendation: plan.recommendations[index], card: plan.card.stops?.[index], originalIndex: index + 1 }));
  const selected = edit.kind === "remove" ? indexed.filter(stop => !edit.indices.includes(stop.originalIndex))
    : edit.kind === "reorder" ? edit.indices.map(index => indexed[index - 1]).filter(Boolean) : indexed;
  const routeOnly = state.routeOnly || plan.state.routeOnly;
  if (routeOnly && edit.kind === "retime") {
    const message = "장소와 방문 순서 중심으로 추천하고 있어요. 바꾸고 싶은 장소나 순서를 알려 주세요.";
    return { status: "chat", message, card: { headline: "", lines: [message] }, state: plan.state };
  }
  const window = assumedTimeWindow(state);
  let scheduled = routeOnly ? selected.map(stop => ({ ...stop, coordinates: stop.item.coordinates,
    dayIndex: stop.item.dayIndex, startTime: "12:00", durationMinutes: 60 }))
    : fitSchedule(selected.map(stop => ({ ...stop, coordinates: stop.item.coordinates, dayIndex: stop.item.dayIndex, durationMinutes: state.pace === "relaxed" && edit.kind === "retime" ? Math.max(90, stop.item.durationMinutes) : stop.item.durationMinutes })), window.startTime, window.specified ? window.endTime : "23:59", state.discovery?.transport ?? "walk", {}, options?.verifiedTravelMinutes);
  if (scheduled && options?.targetItemId && options.targetStartTime && edit.kind === "retime") {
    const targetIndex = scheduled.findIndex(stop => stop.item.id === options.targetItemId);
    const desired = /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(options.targetStartTime)
      ? clockMinutes(options.targetStartTime) : -1;
    if (targetIndex < 0 || desired < 0) scheduled = null;
    else {
      const target = scheduled[targetIndex];
      const prior = scheduled[targetIndex - 1]?.dayIndex === target.dayIndex ? scheduled[targetIndex - 1] : undefined;
      const gap = prior ? options.verifiedTravelMinutes?.[targetIndex - 1]
        ?? scheduleGapMinutes(prior.item.coordinates ?? prior.recommendation.coordinates,
          target.item.coordinates ?? target.recommendation.coordinates, state.discovery?.transport ?? "walk") : 0;
      const earliest = prior ? clockMinutes(prior.startTime) + prior.durationMinutes + gap : clockMinutes(window.startTime);
      const shift = desired - clockMinutes(target.startTime);
      const last = scheduled.filter(stop => stop.dayIndex === target.dayIndex).at(-1)!;
      const finalEnd = clockMinutes(last.startTime) + shift + last.durationMinutes;
      if (desired < earliest || finalEnd > clockMinutes(window.specified ? window.endTime : "23:59")) scheduled = null;
      else scheduled = scheduled.map((stop, index) => index >= targetIndex && stop.dayIndex === target.dayIndex
        ? { ...stop, startTime: formatClock(clockMinutes(stop.startTime) + shift) } : stop);
    }
  }
  if (!scheduled?.length) {
    const message = selected.length ? "지금 장소를 모두 유지하면 이 시간 안에 이동과 관람을 넣기 어려워요. 한 곳을 빼거나 시간을 늘려 볼까요?" : "모든 장소를 빼면 코스가 비게 돼요. 새로 만들 지역이나 남길 곳을 알려 주세요.";
    return { status: "chat", message, card: { headline: "", lines: [message] }, state: plan.state };
  }
  const nextState = { ...state, pinOrder: scheduled.map(stop => stop.item.placeName), requiredPlaces: scheduled.map(stop => stop.item.placeName), addStop: false, preserveExistingPlaces: true,
    excludedPlaces: [...new Set([...state.excludedPlaces, ...indexed.filter(stop => !selected.includes(stop)).map(stop => stop.item.placeName)])],
  };
  const items = scheduled.map((stop, order) => ({ ...stop.item, order, startTime: stop.startTime, durationMinutes: stop.durationMinutes }));
  const hops = scheduled.map((stop, index) => {
    const prev = scheduled[index - 1];
    return prev && prev.dayIndex === stop.dayIndex && prev.coordinates && stop.coordinates ? Math.round(distanceMeters(prev.coordinates, stop.coordinates)) : null;
  });
  const recommendations = scheduled.map((stop, index) => ({ ...stop.recommendation, durationMinutes: stop.durationMinutes, distanceFromPreviousMeters: hops[index] }));
  const stops = scheduled.map((stop, index) => ({ ...stop.card, name: stop.item.placeName, meta: stop.card?.meta ?? stop.item.category, startTime: !routeOnly && window.specified ? stop.startTime : undefined, durationMinutes: !routeOnly && window.specified ? stop.durationMinutes : undefined, dayIndex: stop.item.dayIndex, distanceFromPreviousMeters: hops[index] }));
  const removed = indexed.filter(stop => !selected.includes(stop)).map(stop => stop.item.placeName);
  const message = edit.kind === "remove" ? `${removed.join(", ")}만 뺐어요. 나머지 장소는 그대로 두고 ${routeOnly ? "방문 순서와 동선을 정리했어요." : "이동 시간을 다시 맞췄어요."}`
    : edit.kind === "reorder" ? `${items.map(item => item.placeName).join(" → ")} 순서로 바꿨어요. 장소는 그대로예요.`
      : options?.targetItemId && options.targetStartTime
        ? `${items.find(item => item.id === options.targetItemId)?.placeName ?? "요청한 장소"} 시작을 ${options.targetStartTime}로 옮겼어요. 나머지 장소는 순서대로 이어져요.`
        : `장소와 순서는 그대로 두고 ${window.startTime}부터 ${window.endTime} 안에 마치도록 시간을 맞췄어요.`;
  return { ...plan, state: { ...nextState, routeOnly }, message, condition: { ...plan.condition, startTime: window.startTime, endTime: window.endTime, dateLabel: state.dateLabel || plan.condition.dateLabel, budget: null, timeSpecified: !routeOnly && window.specified },
    design: plan.design ? { ...plan.design, theme: edit.kind === "remove" ? "기존 코스에서 요청한 장소를 제외한 코스" : plan.design.theme, totalDistanceMeters: hops.reduce<number>((sum, hop) => sum + (hop ?? 0), 0) } : undefined,
    items, recommendations, card: { ...plan.card, headline: `${selectedAreas(state).join(" · ")} ${items.length}곳`, lines: [message], stops },
  };
}

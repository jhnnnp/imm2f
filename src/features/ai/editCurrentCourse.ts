import type { AIPlannerReply, AIPlannerState, AIPlannerResult } from "@/features/planning/types/plan";
import type { ChatRoute } from "./chatRoute";
import { assumedTimeWindow, selectedAreas } from "./dateBrief";
import { fitSchedule } from "./schedule";
import { distanceMeters } from "@/features/places/geo";

/** Apply a conversational edit to the existing entities, without another venue search. */
export function editCurrentCourse(plan: AIPlannerReply, edit: NonNullable<ChatRoute["edit"]>, state: AIPlannerState): AIPlannerResult {
  const indexed = plan.items.map((item, index) => ({ item, recommendation: plan.recommendations[index], card: plan.card.stops?.[index], originalIndex: index + 1 }));
  const selected = edit.kind === "remove" ? indexed.filter(stop => !edit.indices.includes(stop.originalIndex))
    : edit.kind === "reorder" ? edit.indices.map(index => indexed[index - 1]).filter(Boolean) : indexed;
  const window = assumedTimeWindow(state);
  const scheduled = fitSchedule(selected.map(stop => ({ ...stop, coordinates: stop.item.coordinates, dayIndex: stop.item.dayIndex, durationMinutes: state.pace === "relaxed" && edit.kind === "retime" ? Math.max(90, stop.item.durationMinutes) : stop.item.durationMinutes })), window.startTime, window.endTime);
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
  const stops = scheduled.map((stop, index) => ({ ...stop.card, name: stop.item.placeName, meta: stop.card?.meta ?? stop.item.category, startTime: stop.startTime, durationMinutes: stop.durationMinutes, dayIndex: stop.item.dayIndex, distanceFromPreviousMeters: hops[index] }));
  const removed = indexed.filter(stop => !selected.includes(stop)).map(stop => stop.item.placeName);
  const message = edit.kind === "remove" ? `${removed.join(", ")}만 뺐어요. 나머지 장소는 그대로 두고 이동 시간을 다시 맞췄어요.`
    : edit.kind === "reorder" ? `${items.map(item => item.placeName).join(" → ")} 순서로 바꿨어요. 장소는 그대로예요.`
      : `장소와 순서는 그대로 두고 ${window.startTime}부터 ${window.endTime} 안에 마치도록 시간을 맞췄어요.`;
  return { ...plan, state: nextState, message, condition: { ...plan.condition, startTime: window.startTime, endTime: window.endTime, dateLabel: state.dateLabel || plan.condition.dateLabel, budget: state.budgetWon ?? null, timeSpecified: true },
    items, recommendations, card: { ...plan.card, headline: `${selectedAreas(state).join(" · ")} ${items.length}곳`, lines: [message], stops },
  };
}

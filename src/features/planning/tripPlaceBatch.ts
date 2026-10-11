"use server";

import { listPlaces } from "@/features/places/actions";
import { withWorkspaceRead } from "@/lib/supabase/readContext";
import { isIsoDate } from "@/lib/dates";
import { appendPlanItem } from "./appendPlanItem";
import { readTripDate, saveCouplePlan } from "./actions";
import type { PlanItem } from "./types/plan";

/** Resolve saved places on the server and commit the complete batch once. */
export async function addPlacesToTrip(placeIds: string[], input: { targetDate: string; dayIndex: number; spread: boolean }) {
  if (!Array.isArray(placeIds) || !placeIds.length || placeIds.length > 200
    || placeIds.some(id => typeof id !== "string" || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id))
    || !input || typeof input.targetDate !== "string" || input.targetDate !== "" && !isIsoDate(input.targetDate)
    || !Number.isInteger(input.dayIndex) || input.dayIndex < 0 || input.dayIndex > 6 || typeof input.spread !== "boolean") {
    return { error: "여행 날짜와 선택한 장소를 확인해 주세요. 한 일정에는 최대 200곳을 담을 수 있어요." };
  }
  return withWorkspaceRead(async () => {
    const [{ places, persist }, { plan }] = await Promise.all([listPlaces(), readTripDate(input.targetDate)]);
    if (!persist || !plan.persist) return { error: "로그인 후 여행에 장소를 담을 수 있어요." };
    const byId = new Map(places.map(place => [place.id, place]));
    const ids = [...new Set(placeIds)];
    if (ids.some(id => !byId.has(id))) return { error: "선택한 장소가 변경됐어요. 장소 목록을 다시 불러와 주세요." };
    let items = [...plan.items];
    let day = input.dayIndex;
    let added = 0;
    let skipped = 0;
    for (const id of ids) {
      const place = byId.get(id)!;
      if (items.some(item => item.placeId === id && (input.spread ? item.dayIndex >= input.dayIndex : item.dayIndex === day))) { skipped += 1; continue; }
      for (;;) {
        if (input.spread) while (day <= 6 && items.filter(item => item.dayIndex === day).length >= 5) day += 1;
        if (day > 6) return { error: "7일 안에 선택한 장소를 모두 배치하기 어려워요. 장소 수를 줄이거나 ‘한 일차에 추가’를 선택해 주세요." };
        const item: PlanItem = { id: `trip-place-${id}-day-${day}`, placeId: id, placeName: place.name,
          category: place.categoryLabel, startTime: "10:00", durationMinutes: place.durationMinutes || 60,
          expectedCost: 0, order: items.length, memo: place.description || "", dayIndex: day, coordinates: place.coordinates };
        const next = appendPlanItem(items, item, "trip");
        const appended = next.duplicate ? undefined : next.items.at(-1);
        const [hours, minutes] = (appended?.startTime ?? "00:00").split(":").map(Number);
        const error = next.error || (appended && hours * 60 + minutes + appended.durationMinutes > 24 * 60
          ? `${place.name}까지 담으면 이날 일정이 자정을 넘어요. 일차를 바꾸거나 기존 일정 시간을 조정해 주세요.` : "");
        if (error) {
          if (input.spread && day < 6) { day += 1; continue; }
          return { error };
        }
        if (next.duplicate) skipped += 1;
        else { items = next.items; added += 1; }
        break;
      }
    }
    if (items.length > 200) return { error: "기존 장소를 합하면 한 일정의 200곳을 넘어가요. 다른 여행에 나누어 담아 주세요." };
    if (added) {
      const saved = await saveCouplePlan("trip", items, { title: plan.title || "우리가 고른 여행", subtitle: plan.notes,
        startDate: input.targetDate || null, dayCount: Math.max(plan.dayCount, day + 1), expectedRevision: plan.revision,
        summary: `선택한 장소 ${added}곳을 여행에 담았어요` });
      if ("error" in saved) return saved;
    }
    return { ok: true as const, items, added, skipped, startDate: input.targetDate, title: plan.title || "우리가 고른 여행" };
  });
}

import type { PlaceCategoryId } from "./types/place";

type ManualPlaceValues = { name: string; category: PlaceCategoryId; district: string; description: string; durationMinutes: number; expectedCostTwo: number | null };
export type ManualPlaceAttempt = { id: string; key: string };

export function isManualPlaceAttemptId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/** Retain the identity after an uncertain response; changed input is a new save. */
export function manualPlaceAttempt(previous: ManualPlaceAttempt | null, input: ManualPlaceValues, makeId: () => string = () => crypto.randomUUID()): ManualPlaceAttempt {
  const key = JSON.stringify([input.name.trim(), input.category, input.district.trim(), input.description.trim(), input.durationMinutes, input.expectedCostTwo]);
  return previous?.key === key ? previous : { id: makeId(), key };
}

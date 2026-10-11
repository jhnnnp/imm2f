import { expect, it } from "vitest";
import { tripSnapshotRecorded } from "./archiveSnapshot";
import type { PlanItem } from "@/features/planning/types/plan";

const stop: PlanItem = { id: "one", placeId: "place", placeName: "우리 카페", category: "카페", startTime: "12:00", durationMinutes: 60, expectedCost: 10000, order: 0, dayIndex: 0, memo: "만나기", coordinates: null };
const snapshot = { title: "우리 여행", startDate: "2026-10-11", dayCount: 1, items: [stop] };

it("prevents duplicate recording after a late coordinate lookup", () => {
  expect(tripSnapshotRecorded({ ...snapshot, items: [{ ...stop, coordinates: [127, 37] }] }, [snapshot])).toBe(true);
});

it("allows a changed itinerary or a different travel date to be recorded", () => {
  expect(tripSnapshotRecorded({ ...snapshot, items: [{ ...stop, memo: "새 약속" }] }, [snapshot])).toBe(false);
  expect(tripSnapshotRecorded({ ...snapshot, startDate: "2026-10-12" }, [snapshot])).toBe(false);
  expect(tripSnapshotRecorded({ ...snapshot, notes: "비 오면 미술관" }, [snapshot])).toBe(false);
});

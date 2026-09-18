import { describe, expect, it } from "vitest";
import { mapActivityRows, relativeTime } from "./activityMap";

describe("mapActivityRows", () => {
  it("marks important actions and falls back to partner names", () => {
    const now = Date.parse("2026-09-18T08:00:00.000Z");
    const rows = mapActivityRows([
      {
        id: "1",
        action: "PLACE_ADDED",
        title: "새 장소를 저장했어요",
        detail: "성심당",
        actor_user_id: "you",
        created_at: "2026-09-18T07:59:30.000Z",
      },
      {
        id: "2",
        action: "PLACE_LIKED",
        title: "장소 상태를 바꿨어요",
        detail: "want",
        actor_user_id: "other",
        created_at: "2026-09-18T07:00:00.000Z",
      },
    ], new Map([["you", "진한"]]), now);

    expect(rows[0]).toMatchObject({ actorName: "진한", important: true, createdAt: "방금" });
    expect(rows[1]).toMatchObject({ actorName: "파트너", important: false, createdAt: "1시간 전" });
  });
});

describe("relativeTime", () => {
  it("returns compact korean labels", () => {
    const now = Date.parse("2026-09-18T12:00:00.000Z");
    expect(relativeTime("2026-09-18T11:59:30.000Z", now)).toBe("방금");
    expect(relativeTime("2026-09-18T11:40:00.000Z", now)).toBe("20분 전");
    expect(relativeTime("2026-09-17T12:00:00.000Z", now)).toBe("어제");
  });
});

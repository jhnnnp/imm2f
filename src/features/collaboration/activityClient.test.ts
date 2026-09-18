import { describe, expect, it } from "vitest";
import { groupActivities, withoutDismissedActivities } from "./activityFeed";

describe("withoutDismissedActivities", () => {
  it("keeps stories that were not tossed away", () => {
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(withoutDismissedActivities(items, ["b"])).toEqual([{ id: "a" }, { id: "c" }]);
  });

  it("does not restore a story the partner already removed", () => {
    const stale = [{ id: "keep" }, { id: "gone" }];
    expect(withoutDismissedActivities(stale, new Set(["gone"]))).toEqual([{ id: "keep" }]);
  });
});

describe("groupActivities", () => {
  it("keeps consecutive matching stories together with their details", () => {
    const groups = groupActivities([
      { id: "1", action: "MEMORY_ADDED", title: "추억을 남겼어요", actorUserId: "you", detail: "우리의 하루" },
      { id: "2", action: "MEMORY_ADDED", title: "추억을 남겼어요", actorUserId: "you", detail: "비 오는 밤" },
      { id: "3", action: "BUCKET_UPDATED", title: "버킷리스트를 남겼어요", actorUserId: "you", detail: "응봉산" },
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0].items.map(item => item.detail)).toEqual(["우리의 하루", "비 오는 밤"]);
    expect(groups[1].items).toHaveLength(1);
  });
});

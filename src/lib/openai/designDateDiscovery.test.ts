import { describe, expect, it } from "vitest";
import { requestedActivityOrder } from "./designDateDiscovery";

describe("user-authored date sequence", () => {
  it("keeps dinner, cafe and performance in the order the user asked", () => {
    expect(requestedActivityOrder("왕십리에서 저녁 먹고 예쁜 카페와 공연장 데이트", ["meal", "cafe", "performance"]))
      .toEqual(["meal", "cafe", "performance"]);
  });

  it("does not insert an unrequested meal into a movie and cafe sequence", () => {
    expect(requestedActivityOrder("영화 보고 카페에 가고 싶어", ["movie", "cafe"]))
      .toEqual(["movie", "cafe"]);
  });
});

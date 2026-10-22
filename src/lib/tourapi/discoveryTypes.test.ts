import { describe, expect, it } from "vitest";
import { tourContentTypeForIntent, tourDiscoveryQuery } from "./discoveryTypes";

describe("official restaurant discovery", () => {
  it.each(["식당", "군산 비빔밥", "한식", "파스타", "초밥"])("uses type39 for food discovery: %s", query => {
    expect(tourContentTypeForIntent({ query })).toBe("39");
  });
  it("browses food records for generic cuisine or dish requests, retaining exact venue names", () => {
    expect(tourContentTypeForIntent({ category: "restaurant", query: "" })).toBe("39");
    expect(tourDiscoveryQuery("39", "식당")).toBe("");
    expect(tourDiscoveryQuery("39", "맛집")).toBe("");
    expect(tourDiscoveryQuery("39", "비빔밥")).toBe("");
    expect(tourDiscoveryQuery("39", "파스타 전문점")).toBe("");
    expect(tourDiscoveryQuery("39", "한식 레스토랑")).toBe("");
    expect(tourDiscoveryQuery("39", "한일관 압구정점")).toBe("한일관 압구정점");
  });
  it.each(["조용한 카페", "오션뷰 카페", "디저트", "베이커리"])("does not assume type39 is a cafe taxonomy: %s", query => {
    expect(tourContentTypeForIntent({ category: "cafe", query })).toBeNull();
    expect(tourContentTypeForIntent({ query })).toBeNull();
  });
});

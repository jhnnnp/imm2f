import { describe, expect, it } from "vitest";
import { TASTE_AREA_CATALOG } from "./areaCatalog";
import { TASTE_AREA_BANDS } from "./areaBands";

describe("TASTE_AREA_CATALOG structure", () => {
  it("assigns scope and tagline on every region and section", () => {
    for (const region of TASTE_AREA_CATALOG) {
      expect(region.scope, region.id).toMatch(/^(seoul|metro|trip)$/);
      expect(region.sections.length, region.id).toBeGreaterThan(0);
      for (const section of region.sections) {
        expect(section.tagline.trim(), `${region.id}/${section.id}`).not.toBe("");
        expect(section.spots.length, `${region.id}/${section.id}`).toBeGreaterThan(0);
      }
    }
  });

  it("keeps trip regions to at most three sections each", () => {
    for (const region of TASTE_AREA_CATALOG.filter(item => item.scope === "trip")) {
      expect(region.sections.length, region.id).toBeLessThanOrEqual(3);
    }
  });

  const COMPACT_SEOUL_REGIONS = new Set(["hongdae", "euljiro", "jongno", "gangnam"]);

  it("keeps core seoul pickers to three sections and three anchor spots", () => {
    for (const region of TASTE_AREA_CATALOG.filter(item => COMPACT_SEOUL_REGIONS.has(item.id))) {
      expect(region.sections.length, region.id).toBeLessThanOrEqual(3);
      for (const section of region.sections) {
        expect(section.spots.length, `${region.id}/${section.id}`).toBeLessThanOrEqual(3);
      }
    }
  });

  it("maps bands to catalog without gaps", () => {
    const catalogIds = TASTE_AREA_CATALOG.map(region => region.id).sort();
    const bandIds = TASTE_AREA_BANDS.flatMap(band => band.regionIds).sort();
    expect(bandIds).toEqual(catalogIds);
  });
});

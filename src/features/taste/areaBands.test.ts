import { describe, expect, it } from "vitest";
import { TASTE_AREA_CATALOG } from "./areaCatalog";
import { TASTE_AREA_BANDS } from "./areaBands";

describe("TASTE_AREA_BANDS", () => {
  it("covers every catalog region exactly once", () => {
    const catalogIds = TASTE_AREA_CATALOG.map(region => region.id).sort();
    const bandIds = TASTE_AREA_BANDS.flatMap(band => band.regionIds).sort();
    expect(bandIds).toEqual(catalogIds);
  });
});

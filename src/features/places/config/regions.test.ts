import { describe, expect, it } from "vitest";
import { regionByQuery } from "./regions";
import { ldongRegnCdFromAreaCode } from "@/lib/tourapi/festivalSchedule";

describe("TourAPI region mappings", () => {
  it.each([
    ["전주", 37, 12, "52"],
    ["군산", 37, 2, "52"],
    ["여수", 38, 13, "46"],
    ["경주", 35, 2, "47"],
    ["포항", 35, 23, "47"],
    ["창원", 36, 16, "48"],
    ["청주", 33, 10, "43"],
    ["천안", 34, 12, "44"],
  ])("maps %s to its TourAPI city and legal-dong province", (name, areaCode, sigunguCode, ldong) => {
    const area = regionByQuery(name as string);
    expect(area).toMatchObject({ areaCode, sigunguCode });
    expect(ldongRegnCdFromAreaCode(area?.areaCode)).toBe(ldong);
  });
});

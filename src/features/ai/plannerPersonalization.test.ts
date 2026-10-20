import { expect, it } from "vitest";
import { emptyDateBrief, withAreas } from "./dateBrief";
import { applyPlannerTasteHints } from "./plannerPersonalization";
import type { TasteDateSeed } from "@/features/taste/types";

const seed: TasteDateSeed = { areas: ["성수"], activities: ["cafe"], cuisine: "양식",
  pace: "relaxed", timeWindow: "afternoon", areaScope: "nearby", indoorPlay: null,
  avoidFoods: [], stayKind: "date", prompt: "", headline: "", lines: [] };

it("asks for this destination even when the couple has saved a favorite neighborhood", () => {
  expect(applyPlannerTasteHints(emptyDateBrief(), seed)).toMatchObject({ areas: [], regions: [], region: "",
    memorySuggestions: { activities: ["cafe"], cuisine: "양식" }, pace: "relaxed" });
});

it("retains a destination explicitly selected for this trip", () => {
  expect(applyPlannerTasteHints(withAreas(emptyDateBrief(), ["부산"]), seed))
    .toMatchObject({ areas: ["부산"], regions: ["부산"], region: "부산" });
});

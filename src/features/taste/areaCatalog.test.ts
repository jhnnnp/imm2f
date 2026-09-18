import { describe, expect, it } from "vitest";
import { TASTE_AREA_CATALOG, flattenRegionAreas } from "./areaCatalog";
import { isBlockedSpotName, isTasteAreaVibe, TASTE_AREA_VIBES } from "./areaVibes";

describe("TASTE_AREA_CATALOG", () => {
  it("uses only approved date vibes on tags", () => {
    const bad: string[] = [];
    for (const region of TASTE_AREA_CATALOG) {
      for (const section of region.sections) {
        for (const spot of section.spots) {
          if (spot.vibe && !isTasteAreaVibe(spot.vibe)) {
            bad.push(`${region.id}/${spot.name}:${spot.vibe}`);
          }
        }
      }
    }
    expect(bad, bad.join("\n")).toEqual([]);
  });

  it("does not list station-only spot names", () => {
    const blocked: string[] = [];
    for (const region of TASTE_AREA_CATALOG) {
      for (const section of region.sections) {
        for (const spot of section.spots) {
          if (isBlockedSpotName(spot.name)) blocked.push(`${region.id}/${spot.name}`);
        }
      }
    }
    expect(blocked, blocked.join("\n")).toEqual([]);
  });

  it("keeps unique spot names within each region", () => {
    for (const region of TASTE_AREA_CATALOG) {
      const names = flattenRegionAreas(region);
      const dup = names.filter((name, index) => names.indexOf(name) !== index);
      expect(dup, `${region.id} duplicates: ${dup.join(", ")}`).toEqual([]);
    }
  });

  it("assigns each spot name to at most one region", () => {
    const byName = new Map<string, string>();
    const conflicts: string[] = [];
    for (const region of TASTE_AREA_CATALOG) {
      for (const name of flattenRegionAreas(region)) {
        const prev = byName.get(name);
        if (prev && prev !== region.id) {
          conflicts.push(`${name}: ${prev} vs ${region.id}`);
        } else {
          byName.set(name, region.id);
        }
      }
    }
    expect(conflicts, conflicts.join("\n")).toEqual([]);
  });

  it("documents every vibe in the allowlist", () => {
    expect(TASTE_AREA_VIBES.length).toBeGreaterThan(10);
  });
});

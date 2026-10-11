import { describe, expect, it } from "vitest";
import { parseMemoryCoordinates } from "./memoryCoordinates";

describe("memory map location", () => {
  it("uses a refined location ahead of the selected place", () => {
    expect(parseMemoryCoordinates("37.5", "127.2", [126.5, 36.8])).toEqual({ coordinates: [127.2, 37.5] });
  });
  it("falls back to the selected place only when both fields are empty", () => {
    expect(parseMemoryCoordinates(" ", "", [126.5, 36.8])).toEqual({ coordinates: [126.5, 36.8] });
    expect(parseMemoryCoordinates("", "")).toEqual({ coordinates: null });
  });
  it.each([["37", ""], ["", "127"], ["invalid", "127"], ["91", "127"], ["37", "181"], ["NaN", "Infinity"]])("rejects an incomplete or invalid pin (%s, %s) instead of silently moving it", (lat, lng) => {
    expect(parseMemoryCoordinates(lat, lng, [126.5, 36.8])).toHaveProperty("error");
  });
  it("accepts zero and boundary coordinates", () => {
    expect(parseMemoryCoordinates("0", "0")).toEqual({ coordinates: [0, 0] });
    expect(parseMemoryCoordinates("-90", "180")).toEqual({ coordinates: [180, -90] });
  });
});

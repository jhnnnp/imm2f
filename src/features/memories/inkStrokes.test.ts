import { describe, expect, it } from "vitest";
import { eraseStrokes, getSvgPathFromStroke, INK_COLORS, parseInkStrokes, strokeHits, strokePath, type InkStroke } from "./inkStrokes";

const sample: InkStroke = {
  id: "s1",
  tool: "pen",
  color: "#2b312e",
  size: 14,
  points: [[10, 10, 0.5], [24, 18, 0.6], [40, 22, 0.4]],
  path: "M 10 10",
};

describe("ink strokes", () => {
  it("builds a closed vector path from outline points", () => {
    const path = getSvgPathFromStroke([[0, 0], [10, 0], [10, 10], [0, 10]]);
    expect(path.startsWith("M")).toBe(true);
    expect(path.endsWith("Z")).toBe(true);
    expect(strokePath([[12, 8, 0.5], [30, 16, 0.7]], 14)).toContain("Q");
    expect(strokePath([[40, 40, 0.5]], 14).length).toBeGreaterThan(40);
  });

  it("erases strokes near the pointer", () => {
    expect(strokeHits(sample, 24, 18, 8)).toBe(true);
    expect(strokeHits(sample, 200, 200, 8)).toBe(false);
    expect(eraseStrokes([sample], 24, 18, 8)).toEqual([]);
    expect(eraseStrokes([sample], 200, 200, 8)).toEqual([sample]);
  });

  it("parses stored strokes and drops broken rows", () => {
    const parsed = parseInkStrokes([
      { id: "ok", tool: "marker", color: "#536f63", size: 26, points: [[1, 2, 0.4], [8, 9]] },
      { id: "bad", points: "nope" },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.tool).toBe("marker");
    expect(parsed[0]?.points[1]?.[2]).toBe(0.5);
  });

  it("keeps a distinct ink palette for the studio", () => {
    const colors = INK_COLORS.map(item => item.color);
    expect(new Set(colors).size).toBe(INK_COLORS.length);
    expect(INK_COLORS.length).toBeGreaterThanOrEqual(10);
  });
});

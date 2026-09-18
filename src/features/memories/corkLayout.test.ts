import { describe, expect, it } from "vitest";
import {
  corkColumnCount,
  defaultCorkPose,
  draggedPose,
  normalizeRotation,
  parseBoardState,
  parseCorkPoses,
  pointerAngle,
  rotatedPose,
  scatterCorkPoses,
} from "./corkLayout";

describe("cork layout", () => {
  it("spreads default poses across the world board", () => {
    const first = defaultCorkPose(0, 4);
    const second = defaultCorkPose(1, 4);
    expect(first.x).toBeLessThan(second.x);
    expect(first.x).toBeGreaterThan(100);
    expect(first.r).not.toBe(0);
    expect(corkColumnCount(1)).toBe(1);
    expect(corkColumnCount(8)).toBe(3);
  });

  it("parses stored poses and ignores broken records", () => {
    const parsed = parseCorkPoses(JSON.stringify({
      a: { x: 120, y: 200, z: 4, r: 8.2 },
      b: { x: "nope" },
    }));
    expect(parsed.a).toEqual({ x: 120, y: 200, z: 4, r: 8.2 });
    expect(parsed.b).toBeUndefined();
  });

  it("moves in world pixels and rotates", () => {
    const origin = { x: 100, y: 80, z: 3, r: -4 };
    const moved = draggedPose(origin, 50, 25, 2);
    expect(moved.x).toBe(125);
    expect(moved.y).toBe(92.5);
    expect(normalizeRotation(190)).toBe(-170);
    const rotated = rotatedPose(origin, 0, 20);
    expect(rotated.r).toBe(16);
    expect(rotatedPose(origin, 0, 14, true).r).toBe(15);
    expect(pointerAngle(0, 0, 0, 10)).toBe(90);
  });

  it("scatters ids with a stable rng and reads v3 boards", () => {
    const poses = scatterCorkPoses(["one", "two"], () => 0.25);
    expect(Object.keys(poses)).toEqual(["one", "two"]);
    expect(poses.one.r).not.toBe(poses.two.r);
    const board = parseBoardState(JSON.stringify({
      v: 3,
      camera: { x: 1, y: 2, zoom: 0.8 },
      poses: { a: { x: 40, y: 50, z: 1, r: 3 } },
      strokes: [{ id: "s", tool: "pen", color: "#2b312e", size: 8, points: [[1, 2, 0.5], [4, 6, 0.5]] }],
    }));
    expect(board?.camera?.zoom).toBe(0.8);
    expect(board?.strokes).toHaveLength(1);
  });
});

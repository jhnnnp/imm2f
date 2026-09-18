import { describe, expect, it } from "vitest";
import { contentRect, fitCamera, fitRect, gridFill, panCamera, screenToWorld, WORLD_W, zoomAt } from "./canvasCamera";

describe("canvas camera", () => {
  it("converts between screen and world space", () => {
    const camera = { x: 40, y: 20, zoom: 2 };
    const world = screenToWorld(camera, { x: 140, y: 80 });
    expect(world).toEqual({ x: 50, y: 30 });
  });

  it("zooms around the cursor and pans", () => {
    const camera = { x: 0, y: 0, zoom: 1 };
    const zoomed = zoomAt(camera, { x: 100, y: 80 }, 2);
    expect(zoomed.zoom).toBe(2);
    expect(screenToWorld(zoomed, { x: 100, y: 80 })).toEqual({ x: 100, y: 80 });
    expect(panCamera(camera, 12, -8)).toEqual({ x: 12, y: -8, zoom: 1 });
  });

  it("fits the world into the viewport", () => {
    const camera = fitCamera({ width: 800, height: 600 });
    expect(camera.zoom).toBeLessThan(1);
    expect(WORLD_W * camera.zoom).toBeLessThanOrEqual(800);
  });

  it("frames a cluster of pieces instead of the whole paper", () => {
    const camera = fitRect({ width: 800, height: 600 }, contentRect([{ x: 120, y: 140 }, { x: 500, y: 160 }]));
    expect(camera.zoom).toBeGreaterThan(0.6);
    const world = screenToWorld(camera, { x: 400, y: 300 });
    expect(world.x).toBeGreaterThan(200);
    expect(world.x).toBeLessThan(700);
  });

  it("keeps the grid aligned with the camera", () => {
    const fill = gridFill({ x: 40, y: -12, zoom: 2 });
    expect(fill.backgroundSize).toBe("64px 64px");
    expect(fill.backgroundPosition).toBe("40px -12px");
    expect(gridFill({ x: 0, y: 0, zoom: 0.18 }).backgroundSize).toBe("5.76px 5.76px");
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMapHoverPreview, mapHoverPreviewPosition, type MapHoverPreview } from "./mapHoverPreview";

const preview: MapHoverPreview = {
  kind: "place", tone: "want", title: "초원사진관", status: "가고 싶은 곳",
  meta: "관광지 · 군산", detail: "전북 군산시 구영2길 12-1", image: "https://example.com/place.jpg",
};
const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height });
function pointer(element: Element, type: string, pointerType = "mouse") {
  const event = new Event(type);
  Object.defineProperty(event, "pointerType", { value: pointerType });
  element.dispatchEvent(event);
}

describe("mapHoverPreviewPosition", () => {
  it("uses the displayed HTML pin's bounds and positions above it without moving the map", () => {
    expect(mapHoverPreviewPosition(rect(100, 50, 600, 500), rect(300, 270, 44, 58), { width: 284, height: 136 }))
      .toEqual({ left: 80, top: 72, arrowX: 142, placement: "above" });
  });
  it("flips near the top and clamps to the left and bottom edges", () => {
    expect(mapHoverPreviewPosition(rect(0, 0, 390, 240), rect(2, 4, 44, 58), { width: 284, height: 180 }))
      .toEqual({ left: 12, top: 48, arrowX: 18, placement: "below" });
  });
  it("keeps a right-edge preview and its arrow within a narrow viewport", () => {
    const position = mapHoverPreviewPosition(rect(0, 0, 220, 400), rect(190, 250, 44, 58), { width: 284, height: 136 });
    expect(position.left).toBe(12);
    expect(position.arrowX).toBe(178);
    expect(position.top).toBe(102);
  });
});

describe("createMapHoverPreview", () => {
  let host: HTMLDivElement;
  let button: HTMLButtonElement;
  let controller: ReturnType<typeof createMapHoverPreview>;
  beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement("div");
    button = document.createElement("button");
    host.append(button);
    document.body.append(host);
    host.getBoundingClientRect = () => DOMRect.fromRect(rect(0, 0, 600, 500));
    button.getBoundingClientRect = () => DOMRect.fromRect(rect(240, 270, 44, 58));
    controller = createMapHoverPreview(host);
  });
  afterEach(() => {
    controller.destroy();
    document.body.replaceChildren();
    vi.useRealTimers();
  });
  const tooltip = () => document.querySelector<HTMLElement>("[role=tooltip]");

  it("waits for deliberate hover, then shows place facts with an accessible description", () => {
    controller.bind(button, preview);
    pointer(button, "pointerenter");
    vi.advanceTimersByTime(119);
    expect(tooltip()).toBeNull();
    vi.advanceTimersByTime(1);
    expect(tooltip()?.textContent).toContain("초원사진관");
    expect(tooltip()?.textContent).toContain("관광지 · 군산");
    expect(tooltip()?.textContent).toContain("전북 군산시 구영2길 12-1");
    expect(tooltip()?.querySelector("img")?.src).toBe(preview.image);
    expect(button.getAttribute("aria-describedby")).toBe(tooltip()?.id);
  });
  it("shows immediately for keyboard focus and Escape removes only its own description", () => {
    button.setAttribute("aria-describedby", "existing-help");
    controller.bind(button, { ...preview, kind: "trip", tone: "trip", status: "1일차 · 2번째 장소", meta: "12:30 · 식사 · 60분 머물러요" });
    button.focus();
    expect(tooltip()?.textContent).toContain("12:30 · 식사 · 60분 머물러요");
    expect(button.getAttribute("aria-describedby")).toContain("existing-help");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(tooltip()).toBeNull();
    expect(button.getAttribute("aria-describedby")).toBe("existing-help");
    expect(document.activeElement).toBe(button);
  });
  it("allows the pointer to enter the tooltip without hiding it, then dismisses after leaving both", () => {
    controller.bind(button, preview);
    pointer(button, "pointerenter");
    vi.advanceTimersByTime(120);
    const shown = tooltip()!;
    pointer(button, "pointerleave");
    vi.advanceTimersByTime(90);
    pointer(shown, "pointerenter");
    vi.advanceTimersByTime(300);
    expect(tooltip()).toBe(shown);
    pointer(shown, "pointerleave");
    vi.advanceTimersByTime(160);
    expect(tooltip()).toBeNull();
  });
  it("does not create a hover preview for touch input or its resulting focus", () => {
    controller.bind(button, preview);
    pointer(button, "pointerenter", "touch");
    pointer(button, "pointerdown", "touch");
    button.focus();
    vi.advanceTimersByTime(500);
    expect(tooltip()).toBeNull();
    expect(button.hasAttribute("aria-describedby")).toBe(false);
  });
  it("dismisses on click while preserving the existing detail handler", () => {
    controller.bind(button, preview);
    const detail = vi.fn();
    button.addEventListener("click", detail);
    button.focus();
    expect(tooltip()).not.toBeNull();
    button.click();
    expect(detail).toHaveBeenCalledOnce();
    expect(tooltip()).toBeNull();
  });
  it("treats provider and user names as plain text and rejects executable image protocols", () => {
    const malicious = '<img src=x onerror="window.pwned=true"><script>bad()</script>';
    controller.bind(button, { ...preview, title: malicious, detail: malicious, image: "javascript:alert(1)" });
    button.focus();
    expect(tooltip()?.querySelector("strong")?.textContent).toBe(malicious);
    expect(tooltip()?.querySelector("p.map-pin-preview-detail")?.textContent).toBe(malicious);
    expect(tooltip()?.querySelector("script")).toBeNull();
    expect(tooltip()?.querySelector("img")).toBeNull();
  });
  it("uses a single tooltip when moving between pins and cleans the previous pin's aria state", () => {
    controller.bind(button, preview);
    const nextButton = document.createElement("button");
    host.append(nextButton);
    nextButton.getBoundingClientRect = button.getBoundingClientRect;
    controller.bind(nextButton, { ...preview, kind: "memory", tone: "memory", title: "둘의 첫 여행", status: "우리의 추억" });
    button.focus();
    nextButton.focus();
    expect(document.querySelectorAll("[role=tooltip]")).toHaveLength(1);
    expect(tooltip()?.textContent).toContain("둘의 첫 여행");
    expect(button.hasAttribute("aria-describedby")).toBe(false);
  });
  it("cancels delayed opens on quick pointer leave and on map movement dismissal", () => {
    controller.bind(button, preview);
    pointer(button, "pointerenter");
    pointer(button, "pointerleave");
    vi.advanceTimersByTime(300);
    expect(tooltip()).toBeNull();
    pointer(button, "pointerenter");
    controller.dismiss();
    vi.advanceTimersByTime(300);
    expect(tooltip()).toBeNull();
  });
  it("does not leave the previous tooltip behind when passing quickly over another pin", () => {
    controller.bind(button, preview);
    const nextButton = document.createElement("button");
    host.append(nextButton);
    nextButton.getBoundingClientRect = button.getBoundingClientRect;
    controller.bind(nextButton, { ...preview, title: "다음 장소" });
    pointer(button, "pointerenter");
    vi.advanceTimersByTime(120);
    pointer(button, "pointerleave");
    pointer(nextButton, "pointerenter");
    vi.advanceTimersByTime(50);
    pointer(nextButton, "pointerleave");
    vi.advanceTimersByTime(300);
    expect(tooltip()).toBeNull();
  });
  it("removes listeners, timers, tooltip and aria state when filters replace pins or the map unmounts", () => {
    const unbind = controller.bind(button, preview);
    button.focus();
    unbind();
    expect(tooltip()).toBeNull();
    expect(button.hasAttribute("aria-describedby")).toBe(false);
    pointer(button, "pointerenter");
    vi.advanceTimersByTime(300);
    expect(tooltip()).toBeNull();
    controller.bind(button, preview);
    pointer(button, "pointerenter");
    controller.destroy();
    vi.advanceTimersByTime(300);
    pointer(button, "pointerenter");
    button.dispatchEvent(new Event("focus"));
    vi.advanceTimersByTime(300);
    expect(tooltip()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});

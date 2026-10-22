// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { closeContextPanel, ContextPanelDrawer, openContextPanel } from "./ContextPanelDrawer";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("makes the fallback guide available as a dismissible dialog at tablet widths", () => {
  const matches = vi.fn((query: string) => ({ media: query, matches: true,
    addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal("matchMedia", matches);
  render(createElement(ContextPanelDrawer, { fallback: createElement("p", null, "현재 기록의 요약") }));
  expect(matches).toHaveBeenCalledWith("(max-width: 1279px)");
  expect(screen.queryByRole("dialog")).toBeNull();
  act(() => openContextPanel());
  expect(screen.getByRole("dialog").getAttribute("aria-modal")).toBe("true");
  expect(screen.getByRole("dialog").textContent).toContain("현재 기록의 요약");
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent(window, new Event("only-us:open-context"));
  expect(screen.getByRole("dialog")).toBeTruthy();
  act(() => closeContextPanel());
  expect(screen.queryByRole("dialog")).toBeNull();
});

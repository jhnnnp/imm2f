// @vitest-environment jsdom
import { createElement as h, type ComponentProps, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type Link from "next/link";
import { AppLink } from "./AppLink";

const native = vi.hoisted(() => ({ props: {} as ComponentProps<typeof Link>, pending: false }));
vi.mock("next/link", () => ({
  default: (props: ComponentProps<typeof Link> & { children: ReactNode }) => {
    native.props = props;
    const { children, href, prefetch: _prefetch, onNavigate: _onNavigate, ...anchor } = props;
    return h("a", { ...anchor, href: String(href) }, children);
  },
  useLinkStatus: () => ({ pending: native.pending }),
}));

afterEach(() => { cleanup(); native.pending = false; });

it("prepares the native loading shell before intent and lets Next navigate without a refresh gate", () => {
  const onNavigate = vi.fn();
  render(h(AppLink, { href: "/trip", onNavigate }, "Trip"));
  expect(native.props.prefetch).toBeNull();
  // Keep the native event callback itself. Wrapping it in an async freshness
  // barrier previously delayed or prevented clicks until the old page reloaded.
  expect(native.props.onNavigate).toBe(onNavigate);
  const event = { preventDefault: vi.fn() };
  native.props.onNavigate?.(event);
  expect(onNavigate).toHaveBeenCalledWith(event);
  expect(event.preventDefault).not.toHaveBeenCalled();
});

it.each(["mouseEnter", "focus", "touchStart"] as const)("activates native auto prefetch immediately on %s for intent-only links", event => {
  render(h(AppLink, { href: "/date", prefetchMode: "hover" }, "Date"));
  expect(native.props.prefetch).toBe(false);
  fireEvent[event](screen.getByRole("link"));
  expect(native.props.prefetch).toBeNull();
});

it("requires new intent after the destination changes", () => {
  const view = render(h(AppLink, { href: "/date?day=1", prefetchMode: "hover" }, "Date"));
  fireEvent.mouseEnter(screen.getByRole("link"));
  expect(native.props.prefetch).toBeNull();
  view.rerender(h(AppLink, { href: "/date?day=2", prefetchMode: "hover" }, "Date"));
  expect(native.props.prefetch).toBe(false);
});

it.each([{ prefetch: false }, { prefetchMode: "never" as const }, { prefetchMode: "never" as const, prefetch: true }])("keeps explicit prefetch opt-outs disabled after intent: %j", options => {
  render(h(AppLink, { href: "/memories", ...options }, "Memories"));
  fireEvent.mouseEnter(screen.getByRole("link"));
  fireEvent.focus(screen.getByRole("link"));
  fireEvent.touchStart(screen.getByRole("link"));
  expect(native.props.prefetch).toBe(false);
});

it("respects caller cancellation before preparing an intent-only link", () => {
  render(h(AppLink, { href: "/places", prefetchMode: "hover", onMouseEnter: event => event.preventDefault() }, "Places"));
  fireEvent.mouseEnter(screen.getByRole("link"));
  expect(native.props.prefetch).toBe(false);
});

it("retains native pending feedback for uncached navigation", () => {
  native.pending = true;
  render(h(AppLink, { href: "/vault" }, "Vault"));
  expect(screen.getByRole("status").textContent).toBe("페이지를 불러오고 있어요.");
});

// @vitest-environment jsdom
import { createElement as h, useState, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useDialogFocus } from "./useDialogFocus";

afterEach(cleanup);

function Harness({ children, blocked = false, initialFocus }: { children?: ReactNode; blocked?: boolean; initialFocus?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useDialogFocus<HTMLDivElement>({ open, initialFocus, onClose: () => { if (!blocked) setOpen(false); } });
  return h("div", null,
    h("button", { onClick: () => setOpen(true) }, "Open"),
    open && h("div", { ref, role: "dialog", "aria-modal": true, "aria-label": "Test", tabIndex: -1 }, children),
  );
}

function open() {
  const trigger = screen.getByRole("button", { name: "Open" });
  trigger.focus();
  fireEvent.click(trigger);
  return { trigger, dialog: screen.getByRole("dialog", { name: "Test" }) };
}

it("focuses a preferred heading, contains Tab and outside focus, then returns to the opener", () => {
  render(h(Harness, null,
    h("button", null, "Delete"),
    h("h2", { "data-dialog-autofocus": true, tabIndex: -1 }, "Safe heading"),
    h("button", null, "Close"),
  ));
  const { trigger, dialog } = open();
  const heading = within(dialog).getByRole("heading");
  const first = within(dialog).getByRole("button", { name: "Delete" });
  const last = within(dialog).getByRole("button", { name: "Close" });
  expect(document.activeElement).toBe(heading);
  fireEvent.keyDown(heading, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(last);
  fireEvent.keyDown(last, { key: "Tab" });
  expect(document.activeElement).toBe(first);
  fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(last);
  act(() => trigger.focus());
  expect(document.activeElement).toBe(heading);
  fireEvent.keyDown(heading, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it("uses the latest close guard without stealing focus when the dialog rerenders", () => {
  const children = [h("input", { key: "a", "aria-label": "Title" }), h("textarea", { key: "b", "aria-label": "Notes" })];
  const view = render(h(Harness, { blocked: true }, children));
  const { dialog } = open();
  const notes = within(dialog).getByRole("textbox", { name: "Notes" });
  notes.focus();
  fireEvent.keyDown(notes, { key: "Escape" });
  expect(screen.getByRole("dialog")).toBe(dialog);
  view.rerender(h(Harness, { blocked: false }, children));
  expect(document.activeElement).toBe(notes);
  fireEvent.keyDown(notes, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("excludes disabled, hidden, inert and closed-details controls from the Tab boundary", () => {
  render(h(Harness, null,
    h("input", { "aria-label": "Visible" }),
    h("fieldset", { disabled: true }, h("input", { "aria-label": "Disabled fieldset" })),
    h("div", { hidden: true }, h("input", { "aria-label": "Hidden" })),
    h("div", { inert: true }, h("button", null, "Inert")),
    h("div", { style: { display: "none" } }, h("button", null, "CSS hidden")),
    h("details", null, h("summary", null, "Coordinates"), h("input", { "aria-label": "Collapsed latitude" })),
  ));
  const { dialog } = open();
  const first = within(dialog).getByRole("textbox", { name: "Visible" });
  const summary = within(dialog).getByText("Coordinates");
  summary.focus();
  fireEvent.keyDown(summary, { key: "Tab" });
  expect(document.activeElement).toBe(first);
  fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(summary);
});

it("recovers focus when dynamic content disappears or an expanded details section closes", async () => {
  const controls = (show: boolean) => [
    h("input", { key: "title", "aria-label": "Title" }),
    show && h("textarea", { key: "preview", "aria-label": "Preview" }),
    h("details", { key: "details", open: true }, h("summary", null, "Coordinates"), h("input", { "aria-label": "Latitude" })),
  ];
  const view = render(h(Harness, null, controls(true)));
  const { dialog } = open();
  const title = within(dialog).getByRole("textbox", { name: "Title" });
  within(dialog).getByRole("textbox", { name: "Preview" }).focus();
  view.rerender(h(Harness, null, controls(false)));
  await waitFor(() => expect(document.activeElement).toBe(title));
  within(dialog).getByRole("textbox", { name: "Latitude" }).focus();
  act(() => dialog.querySelector("details")!.removeAttribute("open"));
  await waitFor(() => expect(document.activeElement).toBe(title));
});

it("keeps focus on the dialog when every control is unavailable", () => {
  render(h(Harness, null, h("input", { disabled: true, "aria-label": "Saving" })));
  const { dialog, trigger } = open();
  expect(document.activeElement).toBe(dialog);
  fireEvent.keyDown(dialog, { key: "Tab" });
  expect(document.activeElement).toBe(dialog);
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(document.activeElement).toBe(trigger);
});

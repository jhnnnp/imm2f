// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CoupleNote, NoteKind } from "./types";

const mocks = vi.hoisted(() => ({
  createNote: vi.fn(), deleteNote: vi.fn(), listNotes: vi.fn(), reorderNotes: vi.fn(),
  updateNoteStatus: vi.fn(), updateNoteContent: vi.fn(), retrySync: vi.fn(),
  router: { refresh: vi.fn() }, emitChanges: vi.fn(),
}));
vi.mock("./actions", () => ({
  createNote: mocks.createNote, deleteNote: mocks.deleteNote, listNotes: mocks.listNotes,
  reorderNotes: mocks.reorderNotes, updateNoteStatus: mocks.updateNoteStatus,
  updateNoteContent: mocks.updateNoteContent,
}));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("@/features/collaboration/useSharedRefresh", () => ({ useSharedRefresh: () => mocks.retrySync }));
vi.mock("@/features/collaboration/activityClient", () => ({ emitCoupleActivitiesChanged: mocks.emitChanges }));
vi.mock("./components/VaultScreenshotImport", () => ({ VaultScreenshotImport: () => null }));
vi.mock("@/features/folders/useFolderWorkspace", () => ({ useFolderWorkspace: () => ({
  workspace: { folders: [], memberships: [], persist: false }, selectedFolderId: "all",
  setSelectedFolderId: vi.fn(), matchesFolder: () => true, folderFor: () => null,
  moveItems: vi.fn(), error: "", pending: false, reload: vi.fn(),
}) }));
vi.mock("@/features/folders/components/FolderShelf", () => ({ FolderShelf: () => null }));
vi.mock("@/features/folders/components/FolderMoveMenu", () => ({ FolderMoveMenu: () => null }));
import { CoupleNotesBoard } from "./components/CoupleNotesBoard";

beforeEach(() => { vi.clearAllMocks(); });
afterEach(cleanup);

const entries: [NoteKind, string, string][] = [
  ["vault", "보관하기", "무엇을 보관할까요?"],
  ["gift", "선물 추가", "어떤 선물인가요?"],
  ["bucket", "메모와 함께 자세히 추가", "둘이 무엇을 해볼까요?"],
];

function openCreate(kind: NoteKind, button: string) {
  render(createElement(CoupleNotesBoard, { kind, initialNotes: [], persist: true }));
  const opener = screen.getAllByRole("button", { name: button, exact: true })[0];
  opener.focus();
  fireEvent.click(opener);
  return { opener, dialog: screen.getByRole("dialog") };
}

it.each(entries)("%s enters the title field and restores opener focus on Escape without writing", (kind, button, label) => {
  const { opener, dialog } = openCreate(kind, button);
  const title = within(dialog).getByRole("textbox", { name: label });
  expect(document.activeElement).toBe(title);
  fireEvent.keyDown(title, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(opener);
  expect(mocks.createNote).not.toHaveBeenCalled();
  expect(mocks.deleteNote).not.toHaveBeenCalled();
  expect(mocks.updateNoteStatus).not.toHaveBeenCalled();
});

it("contains keyboard navigation and preserves editing focus across value changes", () => {
  const { dialog } = openCreate("vault", "보관하기");
  fireEvent.change(within(dialog).getByRole("textbox", { name: "무엇을 보관할까요?" }), { target: { value: "예약 정보" } });
  const first = within(dialog).getByRole("button", { name: "닫기", exact: true });
  const last = within(dialog).getByRole("button", { name: "저장", exact: true });
  first.focus();
  fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(last);
  fireEvent.keyDown(last, { key: "Tab" });
  expect(document.activeElement).toBe(first);
  const detail = within(dialog).getByRole("textbox", { name: "설명 또는 메모" });
  detail.focus();
  fireEvent.change(detail, { target: { value: "예약 변경 메모" } });
  expect(document.activeElement).toBe(detail);
});

it("blocks Escape and backdrop dismissal while a mocked save is pending", async () => {
  let resolve!: (value: { error: string }) => void;
  const response = new Promise<{ error: string }>(done => { resolve = done; });
  mocks.createNote.mockReturnValueOnce(response);
  const { opener, dialog } = openCreate("vault", "보관하기");
  const title = within(dialog).getByRole("textbox", { name: "무엇을 보관할까요?" });
  fireEvent.change(title, { target: { value: "모의 예약번호" } });
  fireEvent.submit(dialog);
  expect(mocks.createNote).toHaveBeenCalledTimes(1);
  expect(within(dialog).getByRole("button", { name: "닫기", exact: true })).toHaveProperty("disabled", true);
  fireEvent.keyDown(dialog, { key: "Escape" });
  fireEvent.click(dialog.parentElement!);
  expect(screen.getByRole("dialog")).toBe(dialog);
  await act(async () => { resolve({ error: "모의 저장 실패" }); await response; });
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(opener);
});

it("focuses the gift detail heading and returns to its card after Escape", () => {
  const note: CoupleNote = { id: "gift-test", kind: "gift", title: "손편지", detail: "마음을 담아요", extra: "", status: "idea", createdAt: "2026-10-11T00:00:00Z" };
  render(createElement(CoupleNotesBoard, { kind: "gift", initialNotes: [note], persist: true }));
  const opener = screen.getByRole("button", { name: "상세", exact: true });
  opener.focus();
  fireEvent.click(opener);
  const dialog = screen.getByRole("dialog", { name: "손편지" });
  const heading = within(dialog).getByRole("heading", { name: "손편지" });
  expect(document.activeElement).toBe(heading);
  const closes = within(dialog).getAllByRole("button", { name: "닫기", exact: true });
  fireEvent.keyDown(heading, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(closes.at(-1));
  fireEvent.keyDown(closes.at(-1)!, { key: "Tab" });
  expect(document.activeElement).toBe(closes[0]);
  fireEvent.keyDown(closes[0], { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(opener);
  expect(mocks.createNote).not.toHaveBeenCalled();
});

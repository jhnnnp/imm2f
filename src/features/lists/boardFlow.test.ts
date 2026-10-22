// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CoupleNote, NoteKind } from "./types";

const mocks = vi.hoisted(() => ({
  create: vi.fn(), update: vi.fn(), status: vi.fn(), remove: vi.fn(), read: vi.fn(), reorder: vi.fn(),
  refresh: vi.fn(), retry: vi.fn(), shared: vi.fn(), emit: vi.fn(),
}));
vi.mock("./actions", () => ({ createNote: mocks.create, updateNoteContent: mocks.update,
  updateNoteStatus: mocks.status, deleteNote: mocks.remove, listNotes: mocks.read, reorderNotes: mocks.reorder }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/features/collaboration/useSharedRefresh", () => ({ useSharedRefresh: mocks.shared }));
vi.mock("@/features/collaboration/activityClient", () => ({ emitCoupleActivitiesChanged: mocks.emit }));
vi.mock("./components/VaultScreenshotImport", () => ({ VaultScreenshotImport: () => null }));
vi.mock("@/features/folders/useFolderWorkspace", () => ({ useFolderWorkspace: () => ({
  workspace: { folders: [], memberships: [], persist: false }, selectedFolderId: "all",
  setSelectedFolderId: vi.fn(), matchesFolder: () => true, folderFor: () => null,
  moveItems: vi.fn(), error: "", pending: false, reload: vi.fn(),
}) }));
vi.mock("@/features/folders/components/FolderShelf", () => ({ FolderShelf: () => null }));
vi.mock("@/features/folders/components/FolderMoveMenu", () => ({ FolderMoveMenu: () => null }));
import { CoupleNotesBoard } from "./components/CoupleNotesBoard";

const entry = (kind: NoteKind): CoupleNote => ({ id: "note-1", kind, title: "우리의 계획", detail: "같이 남긴 이야기", extra: "올해 안에",
  status: kind === "bucket" ? "wish" : kind === "gift" ? "idea" : "kept", createdAt: "2026-10-22T09:00:00Z",
  updatedAt: "2026-10-22T10:00:00Z", createdBy: "partner" });
function view(kind: NoteKind, notes = [entry(kind)], persist = true) {
  return render(createElement(CoupleNotesBoard, { kind, initialNotes: notes, persist,
    collaborators: { viewerId: "me", viewerName: "진", partnerName: "현" } }));
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { resolve, promise }; }
beforeEach(() => {
  vi.clearAllMocks();
  mocks.shared.mockImplementation(() => mocks.retry);
  mocks.update.mockImplementation(async (id, patch) => ({ note: { ...entry("vault"), id, ...patch } }));
  mocks.status.mockResolvedValue({ ok: true, note: { ...entry("bucket"), status: "planning" } });
  mocks.create.mockResolvedValue({ note: { ...entry("bucket"), id: "new-note", title: "새 계획" } });
  mocks.remove.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

it("keeps one compact bucket heading and removes repeated overview/hero statistics", () => {
  view("bucket");
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(screen.queryByLabelText("목록 요약")).toBeNull();
  expect(screen.queryByLabelText("상태별 개수")).toBeNull();
  expect(screen.queryByText("우리의 다음 장면들")).toBeNull();
  expect(screen.getByLabelText("상태 필터")).toBeTruthy();
  expect(screen.getByLabelText("우리의 계획 상태")).toHaveProperty("value", "wish");
});

it.each(["vault", "gift"] as const)("edits %s content with its original partner concurrency version", async kind => {
  mocks.update.mockImplementation(async (id, patch) => ({ note: { ...entry(kind), id, ...patch } }));
  view(kind); fireEvent.click(screen.getByRole("button", { name: "우리의 계획 수정" }));
  const dialog = screen.getByRole("dialog", { name: "기록 수정" });
  fireEvent.change(within(dialog).getByLabelText(kind === "vault" ? "무엇을 보관할까요?" : "어떤 선물인가요?"), { target: { value: "수정한 계획" } });
  fireEvent.change(within(dialog).getByLabelText(kind === "vault" ? "설명 또는 메모" : "아이디어와 준비 메모"), { target: { value: "새로운 이야기" } });
  expect(within(dialog).queryByLabelText("진행 상태")).toBeNull();
  fireEvent.click(within(dialog).getByRole("button", { name: "수정 사항 저장" }));
  await waitFor(() => expect(mocks.update).toHaveBeenCalledWith("note-1", { title: "수정한 계획", detail: "새로운 이야기", extra: "올해 안에" }, entry(kind).updatedAt));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByRole("heading", { name: "수정한 계획" })).toBeTruthy();
  expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.status).not.toHaveBeenCalled();
  expect(mocks.emit).toHaveBeenCalled(); expect(mocks.refresh).toHaveBeenCalled(); expect(mocks.retry).toHaveBeenCalled();
});

it("retains edited text when a partner conflict prevents saving", async () => {
  mocks.update.mockResolvedValue({ error: "파트너가 이 항목을 수정했어요." });
  view("vault"); fireEvent.click(screen.getByRole("button", { name: "우리의 계획 수정" }));
  fireEvent.change(screen.getByRole("textbox", { name: "설명 또는 메모" }), { target: { value: "아직 저장하지 못한 문장" } });
  fireEvent.click(screen.getByRole("button", { name: "수정 사항 저장" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("textbox", { name: "설명 또는 메모" })).toHaveProperty("value", "아직 저장하지 못한 문장");
  expect(screen.getByRole("heading", { name: entry("vault").title })).toBeTruthy();
  expect(mocks.retry).toHaveBeenCalled();
});

it("submits one content edit across clicks before React renders pending state", async () => {
  const result = deferred<{ note: CoupleNote }>(); mocks.update.mockReturnValue(result.promise);
  view("vault"); fireEvent.click(screen.getByRole("button", { name: "우리의 계획 수정" }));
  const save = screen.getByRole("button", { name: "수정 사항 저장" });
  act(() => { fireEvent.click(save); fireEvent.click(save); });
  expect(mocks.update).toHaveBeenCalledTimes(1);
  await act(async () => result.resolve({ note: entry("vault") }));
});

it("rolls a failed status change back and keeps the partner version on retry", async () => {
  mocks.status.mockResolvedValueOnce({ error: "다시 시도해 주세요." });
  view("bucket"); const status = screen.getByLabelText("우리의 계획 상태");
  fireEvent.change(status, { target: { value: "planning" } });
  await screen.findByRole("alert"); expect(status).toHaveProperty("value", "wish");
  fireEvent.change(status, { target: { value: "planning" } });
  await waitFor(() => expect(status).toHaveProperty("value", "planning"));
  expect(mocks.status).toHaveBeenNthCalledWith(1, "note-1", "planning", entry("bucket").updatedAt);
  expect(mocks.status).toHaveBeenCalledTimes(2);
});

it("preserves a failed quick add and reuses its attempt ID without duplicate writes", async () => {
  mocks.create.mockResolvedValueOnce({ error: "응답을 확인하지 못했어요." });
  view("bucket", []);
  const title = screen.getByLabelText("새 버킷리스트 항목"); const when = screen.getByLabelText("목표 시기");
  fireEvent.change(title, { target: { value: "새 계획" } }); fireEvent.change(when, { target: { value: "겨울" } });
  const add = screen.getByRole("button", { name: "추가", exact: true }); fireEvent.click(add);
  await screen.findByRole("alert"); expect(title).toHaveProperty("value", "새 계획"); expect(when).toHaveProperty("value", "겨울");
  act(() => { fireEvent.click(add); fireEvent.click(add); });
  await waitFor(() => expect(screen.getByRole("heading", { name: "새 계획" })).toBeTruthy());
  expect(mocks.create).toHaveBeenCalledTimes(2);
  expect(mocks.create.mock.calls[0][1].attemptId).toBe(mocks.create.mock.calls[1][1].attemptId);
  expect(title).toHaveProperty("value", ""); expect(screen.queryByRole("alert")).toBeNull();
});

it("edits a bucket title, reason and target date using the existing version guard", async () => {
  view("bucket"); fireEvent.click(screen.getByRole("button", { name: "우리의 계획 수정" }));
  fireEvent.change(screen.getByLabelText("함께 해보고 싶은 일"), { target: { value: "겨울 바다" } });
  fireEvent.change(screen.getByLabelText("이루고 싶은 이유 · 계획"), { target: { value: "둘이 걷기" } });
  fireEvent.change(screen.getByLabelText("언제쯤"), { target: { value: "연말" } });
  fireEvent.click(screen.getByRole("button", { name: "저장", exact: true }));
  await waitFor(() => expect(mocks.update).toHaveBeenCalledWith("note-1", { title: "겨울 바다", detail: "둘이 걷기", extra: "연말" }, entry("bucket").updatedAt));
});

it("does not enable persistent content changes in the preview workspace", () => {
  view("bucket", [entry("bucket")], false);
  expect(screen.getByRole("button", { name: "우리의 계획 수정" })).toHaveProperty("disabled", true);
  expect(screen.getByLabelText("우리의 계획 상태")).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", { name: "우리의 계획 완료로 표시" }));
  expect(mocks.status).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
});

it("receives shared partner updates without writing over local records", async () => {
  view("bucket");
  const listener = mocks.shared.mock.calls.at(-1)![0];
  mocks.read.mockResolvedValue({ notes: [{ ...entry("bucket"), title: "파트너가 추가한 계획" }] });
  await act(async () => listener({ isCurrent: () => true }));
  expect(screen.getByRole("heading", { name: "파트너가 추가한 계획" })).toBeTruthy();
  expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
});

it("shows a recoverable message when clipboard access is unavailable", () => {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  view("vault"); fireEvent.click(screen.getByRole("button", { name: "복사" }));
  expect(screen.getByRole("alert").textContent).toContain("번호를 직접 선택");
});

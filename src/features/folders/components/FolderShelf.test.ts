// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { FolderController } from "../useFolderWorkspace";
import { FOLDER_DRAG_MIME, type ArchiveFolder, type FolderWorkspace } from "../types";
import { FolderShelf } from "./FolderShelf";
import { FolderMoveMenu } from "./FolderMoveMenu";

const folders: ArchiveFolder[] = [
  { id: "00000000-0000-0000-0000-000000000001", name: "바다를 보는 날", color: "blue", createdAt: "2026-10-11T00:00:00Z", updatedAt: "2026-10-11T00:00:00Z" },
  { id: "00000000-0000-0000-0000-000000000002", name: "우리의 주말", color: "sage", createdAt: "2026-10-11T00:00:00Z", updatedAt: "2026-10-11T00:00:00Z" },
];
const items = [
  { id: "item-a", title: "바닷가 카페", image: "https://images.example.com/cafe.jpg" },
  { id: "item-b", title: "산책길", image: "/images/walk.jpg" },
  { id: "item-c", title: "기차 예약", image: "javascript:alert(1)" },
];
const workspace: FolderWorkspace = { folders, memberships: [ { itemId: "item-a", folderId: folders[0].id }, { itemId: "item-b", folderId: folders[0].id } ], persist: true };
function controller(overrides: Partial<FolderController> = {}): FolderController {
  return { workspace, selectedFolderId: "all", setSelectedFolderId: vi.fn(), matchesFolder: () => true, folderFor: () => null,
    moveItems: vi.fn().mockResolvedValue(true), error: "", pending: false, reload: vi.fn(),
    create: vi.fn().mockResolvedValue(true), rename: vi.fn().mockResolvedValue(true), remove: vi.fn().mockResolvedValue(true), ...overrides };
}
function mount(value = controller()) {
  return { value, view: render(createElement(FolderShelf, { scope: "places", controller: value, items, label: "장소" })) };
}
function openNewFolder() {
  const trigger = screen.getByRole("button", { name: /새 폴더/ });
  trigger.focus();
  fireEvent.click(trigger);
  return { trigger, dialog: screen.getByRole("dialog", { name: "새로운 모음을 만들어요" }) };
}
function tile(name: string) { return screen.getByRole("button", { name: `${name} 폴더 열기` }).closest("article")!; }
function dragData(payload: unknown, types = [FOLDER_DRAG_MIME]) {
  return { types, getData: vi.fn((type: string) => type === FOLDER_DRAG_MIME ? typeof payload === "string" ? payload : JSON.stringify(payload) : ""), dropEffect: "" };
}
afterEach(cleanup);

it("shows folder and unfiled counts with an image preview and total breadcrumb", () => {
  mount();
  expect(screen.getByRole("button", { name: /전체 장소\s*3/ }).getAttribute("aria-current")).toBe("page");
  expect(within(tile(folders[0].name)).getByText("2개 함께 보관 중")).toBeTruthy();
  expect(within(tile(folders[1].name)).getByText("0개 함께 보관 중")).toBeTruthy();
  expect(screen.getByText("1개 · 아직 이름 없는 모음")).toBeTruthy();
  const photo = tile(folders[0].name).querySelector("img")!;
  expect(photo.getAttribute("src")).toBe(items[0].image);
  expect(photo.getAttribute("loading")).toBe("lazy");
  expect(photo.getAttribute("alt")).toBe("");
  expect(screen.getByRole("button", { name: /미분류/ }).querySelector("img")).toBeNull();
});

it("keeps stale memberships of a deleted folder visible in unfiled", () => {
  mount(controller({ workspace: { ...workspace, memberships: [...workspace.memberships, { itemId: "item-c", folderId: "deleted-folder" }] } }));
  expect(screen.getByText("1개 · 아직 이름 없는 모음")).toBeTruthy();
});

it("navigates named folders, unfiled and the root and reflects the current folder", () => {
  const value = controller({ selectedFolderId: folders[0].id });
  mount(value);
  expect(screen.getByRole("button", { name: `${folders[0].name} 폴더 열기` }).getAttribute("aria-pressed")).toBe("true");
  expect(within(screen.getByRole("navigation", { name: "폴더 위치" })).getByText(folders[0].name)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: `${folders[1].name} 폴더 열기` }));
  expect(value.setSelectedFolderId).toHaveBeenLastCalledWith(folders[1].id);
  fireEvent.click(screen.getByRole("button", { name: /미분류/ }));
  expect(value.setSelectedFolderId).toHaveBeenLastCalledWith("unfiled");
  fireEvent.click(screen.getByRole("button", { name: /전체 장소/ }));
  expect(value.setSelectedFolderId).toHaveBeenLastCalledWith("all");
});

it("creates a folder with a user name, color and stable retry identity", async () => {
  const create = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  mount(controller({ create }));
  const { trigger, dialog } = openNewFolder();
  const input = within(dialog).getByRole("textbox", { name: "폴더 이름" });
  expect(document.activeElement).toBe(input);
  expect(within(dialog).getByRole("button", { name: "저장", exact: true })).toHaveProperty("disabled", true);
  fireEvent.change(input, { target: { value: "우리의 가을 바다" } });
  fireEvent.click(within(dialog).getByRole("radio", { name: /장미/ }));
  fireEvent.click(within(dialog).getByRole("button", { name: "저장", exact: true }));
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  await act(async () => undefined);
  expect(screen.getByRole("dialog")).toBe(dialog);
  expect(input).toHaveProperty("value", "우리의 가을 바다");
  const attempted = create.mock.calls[0][0];
  expect(attempted).toEqual({ name: "우리의 가을 바다", color: "rose", attemptId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
  fireEvent.click(within(dialog).getByRole("button", { name: "저장", exact: true }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(create.mock.calls[1][0]).toEqual(attempted);
  expect(screen.getByRole("status").textContent).toContain("폴더를 저장했어요.");
  expect(document.activeElement).toBe(trigger);
});

it("renames and recolors a folder using its original versioned record", async () => {
  const value = controller();
  mount(value);
  fireEvent.click(screen.getByRole("button", { name: `${folders[0].name} 폴더 관리` }));
  const dialog = screen.getByRole("dialog", { name: "폴더에 이름을 붙여요" });
  const input = within(dialog).getByRole("textbox", { name: "폴더 이름" });
  expect(input).toHaveProperty("value", folders[0].name);
  expect(within(dialog).getByRole("radio", { name: /하늘/ })).toHaveProperty("checked", true);
  fireEvent.change(input, { target: { value: "파도가 들리는 곳" } });
  fireEvent.click(within(dialog).getByRole("radio", { name: /라벤더/ }));
  fireEvent.click(within(dialog).getByRole("button", { name: "저장", exact: true }));
  await waitFor(() => expect(value.rename).toHaveBeenCalledWith(folders[0], { name: "파도가 들리는 곳", color: "lavender" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("explains deletion preserves contents and only sends a folder removal after confirmation", async () => {
  const value = controller();
  mount(value);
  fireEvent.click(screen.getByRole("button", { name: `${folders[0].name} 폴더 관리` }));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "폴더 삭제", exact: true }));
  const dialog = screen.getByRole("dialog", { name: "폴더를 지울까요?" });
  expect(within(dialog).getByText(/삭제되지 않고 미분류로 옮겨져요/)).toBeTruthy();
  expect(value.remove).not.toHaveBeenCalled();
  await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "취소" })));
  fireEvent.click(within(dialog).getByRole("button", { name: "폴더만 삭제" }));
  await waitFor(() => expect(value.remove).toHaveBeenCalledWith(folders[0]));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByRole("status").textContent).toContain("안의 항목은 미분류에 남아 있어요.");
});

it("contains keyboard focus and returns focus to the opener after Escape", () => {
  mount();
  const { trigger, dialog } = openNewFolder();
  const cancel = within(dialog).getByRole("button", { name: "취소" });
  const close = within(dialog).getByRole("button", { name: "폴더 창 닫기" });
  cancel.focus();
  fireEvent.keyDown(cancel, { key: "Tab" });
  expect(document.activeElement).toBe(close);
  fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(cancel);
  fireEvent.keyDown(cancel, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it("keeps a draft open while pending and after a failed mutation", async () => {
  let complete!: (result: boolean) => void;
  const create = vi.fn(() => new Promise<boolean>(resolve => { complete = resolve; }));
  const base = controller({ create });
  const { view } = mount(base);
  const { dialog } = openNewFolder();
  fireEvent.change(within(dialog).getByRole("textbox", { name: "폴더 이름" }), { target: { value: "비 오는 날" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "저장", exact: true }));
  view.rerender(createElement(FolderShelf, { scope: "places", controller: { ...base, pending: true }, items, label: "장소" }));
  expect(within(dialog).getByRole("textbox")).toHaveProperty("disabled", true);
  expect(within(dialog).getByRole("button", { name: "취소" })).toHaveProperty("disabled", true);
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(screen.getByRole("dialog")).toBe(dialog);
  fireEvent.click(dialog.parentElement!);
  expect(screen.getByRole("dialog")).toBe(dialog);
  await act(async () => complete(false));
  view.rerender(createElement(FolderShelf, { scope: "places", controller: { ...base, error: "저장에 실패했어요." }, items, label: "장소" }));
  expect(screen.getByRole("dialog")).toBe(dialog);
  expect(within(dialog).getByRole("textbox")).toHaveProperty("value", "비 오는 날");
  expect(within(dialog).getByRole("alert").textContent).toContain("저장에 실패했어요.");
  expect(within(dialog).getByRole("button", { name: "저장", exact: true })).toHaveProperty("disabled", false);
});

it("disables persistence controls when unavailable and lets load failures be retried", () => {
  const value = controller({ workspace: { ...workspace, persist: false }, error: "폴더를 불러오지 못했어요." });
  mount(value);
  expect(screen.getByRole("button", { name: /새 폴더/ })).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", { name: `${folders[0].name} 폴더 관리` })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", { name: "다시 불러오기" }));
  expect(value.reload).toHaveBeenCalledTimes(1);
});

it("moves a validated same-scope drop once and reports the item count", async () => {
  const value = controller();
  mount(value);
  const destination = tile(folders[1].name);
  const dataTransfer = dragData({ scope: "places", ids: ["item-a", "item-b", "item-a"] });
  fireEvent.dragOver(destination, { dataTransfer });
  expect(dataTransfer.dropEffect).toBe("move");
  expect(destination.className).toContain("is-drag-over");
  fireEvent.drop(destination, { dataTransfer });
  await waitFor(() => expect(value.moveItems).toHaveBeenCalledWith(["item-a", "item-b"], folders[1].id));
  expect(screen.getByRole("status").textContent).toContain("2개 항목을 폴더에 옮겼어요.");
});

it.each([
  { scope: "vault", ids: ["item-a"] },
  { scope: "places", ids: ["unknown-item"] },
  { scope: "places", ids: ["item-a", "unknown-item"] },
  { scope: "places", ids: [] },
  "malformed JSON",
])("rejects an unrelated, unknown or malformed drag payload %j", payload => {
  const value = controller();
  mount(value);
  fireEvent.drop(tile(folders[0].name), { dataTransfer: dragData(payload) });
  expect(value.moveItems).not.toHaveBeenCalled();
});

it.each(["pending", "unavailable"])("ignores drops while %s", condition => {
  const value = controller(condition === "pending" ? { pending: true } : { workspace: { ...workspace, persist: false } });
  mount(value);
  const dataTransfer = dragData({ scope: "places", ids: ["item-a"] });
  fireEvent.dragOver(tile(folders[0].name), { dataTransfer });
  fireEvent.drop(tile(folders[0].name), { dataTransfer });
  expect(dataTransfer.dropEffect).toBe("");
  expect(value.moveItems).not.toHaveBeenCalled();
});

it("moves to unfiled explicitly and does not report success for a failed drop", async () => {
  const moveItems = vi.fn().mockResolvedValue(false);
  mount(controller({ moveItems }));
  fireEvent.drop(screen.getByRole("button", { name: /미분류/ }).closest("article")!, { dataTransfer: dragData({ scope: "places", ids: ["item-a"] }) });
  await waitFor(() => expect(moveItems).toHaveBeenCalledWith(["item-a"], null));
  await act(async () => undefined);
  expect(screen.queryByRole("status")).toBeNull();
});

it("allows repeated explicit bulk moves to null even with current value null", () => {
  const onMove = vi.fn();
  render(createElement(FolderMoveMenu, { folders, value: null, disabled: false, onMove }));
  const select = screen.getByRole("combobox", { name: "폴더로 이동" });
  fireEvent.change(select, { target: { value: "unfiled" } });
  expect(onMove).toHaveBeenLastCalledWith(null);
  expect(select).toHaveProperty("value", "");
  fireEvent.change(select, { target: { value: "unfiled" } });
  expect(onMove).toHaveBeenCalledTimes(2);
});

it("labels the current folder while using a command placeholder", () => {
  const onMove = vi.fn();
  render(createElement(FolderMoveMenu, { folders, value: folders[0].id, disabled: false, onMove }));
  expect(screen.getByRole("option", { name: `${folders[0].name} · 현재 폴더` })).toBeTruthy();
  const select = screen.getByRole("combobox");
  expect(select).toHaveProperty("value", "");
  fireEvent.change(select, { target: { value: folders[1].id } });
  expect(onMove).toHaveBeenCalledWith(folders[1].id);
  expect(select).toHaveProperty("value", "");
});

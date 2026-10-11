// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoupleNote } from "./types";

const mocks = vi.hoisted(() => ({
  createNote: vi.fn(), deleteNote: vi.fn(), listNotes: vi.fn(), reorderNotes: vi.fn(),
  updateNoteStatus: vi.fn(), updateNoteContent: vi.fn(), moveItems: vi.fn(), retrySync: vi.fn(),
  router: { refresh: vi.fn() }, initialMemberships: {} as Record<string, string>,
  importedNotes: [] as CoupleNote[],
}));

vi.mock("./actions", () => ({
  createNote: mocks.createNote, deleteNote: mocks.deleteNote, listNotes: mocks.listNotes,
  reorderNotes: mocks.reorderNotes, updateNoteStatus: mocks.updateNoteStatus,
  updateNoteContent: mocks.updateNoteContent,
}));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("@/features/collaboration/useSharedRefresh", () => ({ useSharedRefresh: () => mocks.retrySync }));
vi.mock("@/features/collaboration/activityClient", () => ({ emitCoupleActivitiesChanged: vi.fn() }));
vi.mock("./components/VaultScreenshotImport", async () => {
  const { createElement } = await import("react");
  return { VaultScreenshotImport: ({ onSaved }: { onSaved: (notes: CoupleNote[]) => void }) => createElement("button", {
    type: "button", onClick: () => onSaved(mocks.importedNotes),
  }, "모의 스크린샷 저장") };
});
vi.mock("@/features/folders/useFolderWorkspace", async () => {
  const { useCallback, useState } = await import("react");
  return { useFolderWorkspace: (scope: string | null) => {
    const [selectedFolderId, setSelectedFolderId] = useState("all");
    const [memberships, setMemberships] = useState(mocks.initialMemberships);
    const folderFor = useCallback((id: string) => memberships[id] ?? null, [memberships]);
    const matchesFolder = useCallback((id: string) => selectedFolderId === "all"
      || (selectedFolderId === "unfiled" ? !memberships[id] : memberships[id] === selectedFolderId), [memberships, selectedFolderId]);
    return {
      workspace: { folders: scope ? [
        { id: "travel", name: "여행의 조각", color: "sage" },
        { id: "letters", name: "둘의 편지", color: "rose" },
      ] : [], memberships, persist: Boolean(scope) },
      selectedFolderId, setSelectedFolderId, matchesFolder, folderFor, pending: false, error: "", reload: vi.fn(),
      moveItems: async (ids: string[], folderId: string | null) => {
        const success = await mocks.moveItems(ids, folderId);
        if (success) setMemberships(current => {
          const next = { ...current };
          for (const id of ids) { if (folderId) next[id] = folderId; else delete next[id]; }
          return next;
        });
        return success;
      },
    };
  } };
});
vi.mock("@/features/folders/components/FolderShelf", async () => {
  const { createElement } = await import("react");
  type Controller = { setSelectedFolderId: (id: string) => void; workspace: { folders: { id: string; name: string }[] } };
  return { FolderShelf: ({ controller }: { controller: Controller }) => createElement("nav", { "aria-label": "보관함 폴더" },
    ...[{ id: "all", name: "전체 기록 보기" }, { id: "unfiled", name: "미분류 기록 보기" }, ...controller.workspace.folders]
      .map(folder => createElement("button", { key: folder.id, type: "button", onClick: () => controller.setSelectedFolderId(folder.id) }, folder.name)),
  ) };
});
vi.mock("@/features/folders/components/FolderMoveMenu", async () => {
  const { createElement } = await import("react");
  type Props = { folders: { id: string; name: string }[]; disabled: boolean; onMove: (id: string | null) => Promise<boolean> };
  return { FolderMoveMenu: ({ folders, disabled, onMove }: Props) => createElement("select", {
    "aria-label": "폴더 이동", defaultValue: "", disabled,
    onChange: (event: { target: { value: string } }) => void onMove(event.target.value === "_" ? null : event.target.value),
  }, createElement("option", { value: "" }, "폴더로 이동"), createElement("option", { value: "_" }, "미분류"),
  ...folders.map(folder => createElement("option", { key: folder.id, value: folder.id }, folder.name))) };
});

import { CoupleNotesBoard } from "./components/CoupleNotesBoard";

const train: CoupleNote = { id: "train", kind: "vault", title: "군산 기차 예약", detail: "10시 출발", extra: "1234", status: "kept", createdAt: "2026-10-11T00:00:00Z" };
const letter: CoupleNote = { id: "letter", kind: "vault", title: "여름의 편지", detail: "함께한 계절", extra: "", status: "used", createdAt: "2026-10-11T00:00:00Z" };
const hotel: CoupleNote = { id: "hotel", kind: "vault", title: "바다가 보이는 숙소", detail: "16시 체크인", extra: "5678", status: "kept", createdAt: "2026-10-11T00:00:00Z" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.initialMemberships = { train: "travel", letter: "letters" };
  mocks.importedNotes = [hotel];
  mocks.moveItems.mockResolvedValue(true);
  mocks.createNote.mockResolvedValue({ note: hotel });
  mocks.reorderNotes.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

function board(notes: CoupleNote[] = [train, letter, hotel]) {
  return render(createElement(CoupleNotesBoard, { kind: "vault", initialNotes: notes, persist: true }));
}

function openFolder(name: string) {
  fireEvent.click(within(screen.getByRole("navigation", { name: "보관함 폴더" })).getByRole("button", { name }));
}

function card(title: string) {
  return screen.getByRole("heading", { name: title, level: 2 }).closest("li")!;
}

describe("vault folder organization", () => {
  it("combines folder, status, and search and preserves the scope when clearing filters", () => {
    board();
    openFolder("여행의 조각");
    expect(screen.queryByRole("heading", { name: letter.title })).toBeNull();
    expect(screen.getByRole("heading", { name: train.title })).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "목록 검색" }), { target: { value: letter.title } });
    expect(screen.getByText("조건에 맞는 기록이 없어요.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "필터 초기화" }));
    expect(screen.getByRole("heading", { name: train.title })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: letter.title })).toBeNull();
    fireEvent.click(within(screen.getByRole("group", { name: "상태 필터" })).getByRole("button", { name: "사용 완료" }));
    expect(screen.queryByRole("heading", { name: train.title })).toBeNull();
  });

  it("moves an existing record without changing or deleting its content", async () => {
    board();
    await act(async () => fireEvent.change(within(card(hotel.title)).getByRole("combobox", { name: "폴더 이동" }), { target: { value: "travel" } }));
    expect(mocks.moveItems).toHaveBeenCalledWith([hotel.id], "travel");
    openFolder("여행의 조각");
    expect(screen.getByRole("heading", { name: hotel.title })).toBeTruthy();
    expect(mocks.deleteNote).not.toHaveBeenCalled();
    expect(mocks.updateNoteContent).not.toHaveBeenCalled();
  });

  it("moves only selected visible records together and supports unfiled", async () => {
    board();
    fireEvent.click(screen.getByRole("checkbox", { name: `${train.title} 선택` }));
    fireEvent.click(screen.getByRole("checkbox", { name: `${hotel.title} 선택` }));
    const bulk = screen.getByText("2개 선택").closest("div")!;
    await act(async () => fireEvent.change(within(bulk).getByRole("combobox", { name: "폴더 이동" }), { target: { value: "_" } }));
    expect(mocks.moveItems).toHaveBeenCalledWith([train.id, hotel.id], null);
    openFolder("미분류 기록 보기");
    expect(screen.getByRole("heading", { name: train.title })).toBeTruthy();
    expect(screen.getByRole("heading", { name: hotel.title })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: letter.title })).toBeNull();
  });

  it("includes selected records in the drag payload and keeps ordinary reorder independent", () => {
    board();
    fireEvent.click(screen.getByRole("checkbox", { name: `${train.title} 선택` }));
    fireEvent.click(screen.getByRole("checkbox", { name: `${hotel.title} 선택` }));
    const dataTransfer = { setData: vi.fn(), effectAllowed: "" };
    fireEvent.dragStart(card(train.title), { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenCalledWith("application/x-only-us-folder-items", JSON.stringify({ scope: "vault", ids: [train.id, hotel.id] }));
    fireEvent.drop(card(letter.title));
    expect(mocks.reorderNotes).not.toHaveBeenCalled();
  });

  it("retains single-card reorder in the unfiltered all-records view", async () => {
    board();
    const dataTransfer = { setData: vi.fn(), effectAllowed: "" };
    fireEvent.dragStart(card(train.title), { dataTransfer });
    await act(async () => fireEvent.drop(card(hotel.title)));
    expect(mocks.reorderNotes).toHaveBeenCalledWith("vault", [letter.id, hotel.id, train.id]);
    expect(mocks.moveItems).not.toHaveBeenCalled();
  });

  it("saves new manual notes into the opened folder", async () => {
    board([train]);
    openFolder("여행의 조각");
    fireEvent.click(screen.getAllByRole("button", { name: "보관하기", exact: true })[0]);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("새 기록은 이 폴더에 함께 담겨요.")).toBeTruthy();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "무엇을 보관할까요?" }), { target: { value: hotel.title } });
    await act(async () => fireEvent.submit(dialog));
    expect(mocks.moveItems).toHaveBeenCalledWith([hotel.id], "travel");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("heading", { name: hotel.title })).toBeTruthy();
  });

  it("keeps a successful save when folder assignment fails and gives recovery guidance", async () => {
    mocks.moveItems.mockResolvedValue(false);
    board([train]);
    openFolder("여행의 조각");
    fireEvent.click(screen.getAllByRole("button", { name: "보관하기", exact: true })[0]);
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "무엇을 보관할까요?" }), { target: { value: hotel.title } });
    await act(async () => fireEvent.submit(dialog));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("기록은 저장됐지만 폴더에 넣지 못했어요");
    openFolder("미분류 기록 보기");
    expect(screen.getByRole("heading", { name: hotel.title })).toBeTruthy();
    expect(mocks.createNote).toHaveBeenCalledTimes(1);
    expect(mocks.deleteNote).not.toHaveBeenCalled();
  });

  it("files every imported record together into the current folder", async () => {
    mocks.importedNotes = [hotel, { ...hotel, id: "ticket", title: "바다 기차표" }];
    board([train]);
    openFolder("여행의 조각");
    fireEvent.click(screen.getAllByRole("button", { name: "보관하기", exact: true })[0]);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "모의 스크린샷 저장" })));
    expect(mocks.moveItems).toHaveBeenCalledWith(["hotel", "ticket"], "travel");
    expect(screen.getByRole("heading", { name: hotel.title })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "바다 기차표" })).toBeTruthy();
  });

  it("shows an empty named folder and never suggests deleting its records", () => {
    board([]);
    openFolder("둘의 편지");
    expect(screen.getByRole("heading", { name: "‘둘의 편지’에 첫 기록을 담아볼까요?" })).toBeTruthy();
    expect(mocks.deleteNote).not.toHaveBeenCalled();
  });

  it("does not show folder organization for gift lists", () => {
    render(createElement(CoupleNotesBoard, { kind: "gift", initialNotes: [{ ...letter, kind: "gift", status: "idea" }], persist: true }));
    expect(screen.queryByRole("navigation", { name: "보관함 폴더" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "폴더 이동" })).toBeNull();
    expect(screen.getByRole("heading", { name: letter.title })).toBeTruthy();
  });
});

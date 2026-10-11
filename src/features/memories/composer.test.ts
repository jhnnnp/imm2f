// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CreateMemoryInput, Memory } from "./types";

const mocks = vi.hoisted(() => ({
  createMemory: vi.fn(), updateMemory: vi.fn(), deleteMemory: vi.fn(),
  readMemoryWorkspace: vi.fn(), createClient: vi.fn(), retrySync: vi.fn(),
  emitChanges: vi.fn(),
  session: { mode: "authenticated", userId: "test-user", coupleId: "test-couple", displayName: "나", partner: null },
}));
vi.mock("./actions", () => ({
  createMemory: mocks.createMemory, updateMemory: mocks.updateMemory,
  deleteMemory: mocks.deleteMemory, readMemoryWorkspace: mocks.readMemoryWorkspace,
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: mocks.createClient }));
vi.mock("@/features/auth/components/SessionProvider", () => ({ useAppSession: () => mocks.session }));
vi.mock("@/features/collaboration/useSharedRefresh", () => ({ useSharedRefresh: () => mocks.retrySync }));
vi.mock("@/features/collaboration/activityClient", () => ({ emitCoupleActivitiesChanged: mocks.emitChanges }));
vi.mock("./resolvePhotoUrls", () => ({ useResolvedMemories: (memories: Memory[]) => memories }));
vi.mock("./photoInspect", () => ({ inspectMemoryPhoto: vi.fn() }));
vi.mock("./components/MemoryCanvas", async () => {
  const React = await import("react");
  return { MemoryCanvas: ({ children }: { children: ReactNode }) => React.createElement(React.Fragment, null, children) };
});
vi.mock("./components/CorkPiece", async () => {
  const React = await import("react");
  return { CorkPiece: ({ children }: { children: ReactNode }) => React.createElement("div", null, children) };
});
vi.mock("next/link", async () => {
  const React = await import("react");
  return { default: ({ children, href, className }: { children: ReactNode; href: string; className?: string }) =>
    React.createElement("a", { href, className }, children) };
});
import { MemoryTimeline } from "./components/MemoryTimeline";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createClient.mockReturnValue(null);
  mocks.createMemory.mockImplementation(async (input: CreateMemoryInput) => ({ memory: {
    id: input.attemptId!, title: input.title, happenedOn: input.happenedOn,
    description: input.description, locationLabel: input.locationLabel,
    memoryType: input.memoryType ?? "free", placeId: input.placeId ?? null,
    coordinates: null, createdBy: "test-user", createdAt: "2026-10-11T00:00:00Z",
    coverUrl: null, photos: [],
  } satisfies Memory }));
});
afterEach(cleanup);

function openComposer() {
  render(createElement(MemoryTimeline, { initialMemories: [], places: [], persist: true }));
  fireEvent.click(screen.getByRole("button", { name: "추억 남기기" }));
  return screen.getByRole("dialog", { name: "오늘의 장면을 골라요" });
}

it.each(["사진 없이 기록", "다음"])("%s advances to an editable story without creating a memory", async label => {
  const photoDialog = openComposer();
  fireEvent.click(within(photoDialog).getByRole("button", { name: label, exact: true }));
  const storyDialog = screen.getByRole("dialog", { name: "이 장면에 이름을 붙여요" });
  const title = within(storyDialog).getByRole("textbox", { name: "이 기억의 제목" }) as HTMLInputElement;
  expect(title.disabled).toBe(false);
  expect((title.closest("fieldset") as HTMLFieldSetElement).disabled).toBe(false);
  expect(within(storyDialog).getByRole("button", { name: "기억으로 남기기" })).toHaveProperty("disabled", false);
  // Flush async event continuations: a hidden default form action must not save.
  await waitFor(() => expect(title.value).toBe("우리의 하루"));
  expect(mocks.createMemory).not.toHaveBeenCalled();
  expect(mocks.createClient).not.toHaveBeenCalled();
  expect(mocks.emitChanges).not.toHaveBeenCalled();
});

it("ignores a form submission while the composer is still choosing photos", async () => {
  const photoDialog = openComposer();
  fireEvent.submit(photoDialog);
  await waitFor(() => expect(screen.getByRole("dialog", { name: "오늘의 장면을 골라요" })).toBe(photoDialog));
  expect(mocks.createMemory).not.toHaveBeenCalled();
  expect(mocks.createClient).not.toHaveBeenCalled();
  expect(mocks.emitChanges).not.toHaveBeenCalled();
});

it("keeps keyboard focus in the composer and returns it to the opener on Escape without saving", () => {
  render(createElement(MemoryTimeline, { initialMemories: [], places: [], persist: true }));
  const opener = screen.getByRole("button", { name: "추억 남기기" });
  opener.focus();
  fireEvent.click(opener);
  const photoDialog = screen.getByRole("dialog", { name: "오늘의 장면을 골라요" });
  expect(photoDialog.contains(document.activeElement)).toBe(true);
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(opener);
  expect(mocks.createMemory).not.toHaveBeenCalled();
});

it("does not discard the composer when Escape is pressed while saving", async () => {
  let resolveSave!: (result: { error: string; keepUploadedPhotos: boolean }) => void;
  mocks.createMemory.mockImplementationOnce(() => new Promise(resolve => { resolveSave = resolve; }));
  const photoDialog = openComposer();
  fireEvent.click(within(photoDialog).getByRole("button", { name: "사진 없이 기록" }));
  const storyDialog = screen.getByRole("dialog", { name: "이 장면에 이름을 붙여요" });
  fireEvent.click(within(storyDialog).getByRole("button", { name: "기억으로 남기기" }));
  await waitFor(() => expect(mocks.createMemory).toHaveBeenCalledTimes(1));
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(screen.getByRole("dialog", { name: "이 장면에 이름을 붙여요" })).toBe(storyDialog);
  resolveSave({ error: "저장 결과를 다시 확인해 주세요.", keepUploadedPhotos: true });
  await waitFor(() => expect(within(storyDialog).getByRole("button", { name: "저장 결과 다시 확인" })).toHaveProperty("disabled", false));
  expect(mocks.createMemory).toHaveBeenCalledTimes(1);
});

it("names the memory edit dialog and closes an untouched edit with Escape without writing", () => {
  const memory: Memory = {
    id: "e086990c-af10-435e-a5d3-f3bd281b403a", title: "같이 걷던 날", happenedOn: "2026-10-10",
    description: "", locationLabel: "", memoryType: "free", placeId: null, coordinates: null,
    createdBy: "test-user", createdAt: "2026-10-11T00:00:00Z", coverUrl: null, photos: [],
  };
  render(createElement(MemoryTimeline, { initialMemories: [memory], places: [], persist: true }));
  fireEvent.click(screen.getByRole("tab", { name: "앨범", exact: true }));
  const opener = screen.getByRole("button", { name: /같이 걷던 날/ });
  opener.focus();
  fireEvent.click(opener);
  const viewer = screen.getByRole("dialog", { name: "같이 걷던 날" });
  expect(document.activeElement).toBe(within(viewer).getByRole("heading", { name: "같이 걷던 날" }));
  fireEvent.click(within(viewer).getByRole("button", { name: "수정", exact: true }));
  const editDialog = screen.getByRole("dialog", { name: "이 장면을 다듬어요" });
  fireEvent.keyDown(editDialog, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(opener);
  expect(mocks.updateMemory).not.toHaveBeenCalled();
  expect(mocks.deleteMemory).not.toHaveBeenCalled();
});

it("creates exactly one memory only after entering its title and explicitly saving", async () => {
  const photoDialog = openComposer();
  fireEvent.click(within(photoDialog).getByRole("button", { name: "사진 없이 기록" }));
  const storyDialog = screen.getByRole("dialog", { name: "이 장면에 이름을 붙여요" });
  const title = within(storyDialog).getByRole("textbox", { name: "이 기억의 제목" });
  fireEvent.change(title, { target: { value: "우리가 직접 적은 기억" } });
  expect(mocks.createMemory).not.toHaveBeenCalled();
  fireEvent.click(within(storyDialog).getByRole("button", { name: "기억으로 남기기" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(mocks.createMemory).toHaveBeenCalledTimes(1);
  expect(mocks.createMemory).toHaveBeenCalledWith(expect.objectContaining({
    title: "우리가 직접 적은 기억", photos: [], attemptId: expect.any(String),
  }));
  expect(mocks.createClient).not.toHaveBeenCalled();
  expect(mocks.emitChanges).toHaveBeenCalledTimes(1);
});

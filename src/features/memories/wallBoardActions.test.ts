import { beforeEach, expect, it, vi } from "vitest";
import { loadMemoryWallBoard, saveMemoryWallBoard } from "./wallBoardActions";
import { emptyBoardState } from "./corkLayout";
import { createWallText } from "./wallText";

const mocks = vi.hoisted(() => ({ session: vi.fn(), createClient: vi.fn(), from: vi.fn(), update: vi.fn(), insert: vi.fn(), results: [] as unknown[] }));
vi.mock("@/features/auth/session", () => ({ getAppSession: mocks.session }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
const scope = { userId: "user-a", coupleId: "couple-a" };
beforeEach(() => {
  for (const mock of [mocks.session, mocks.createClient, mocks.from, mocks.update, mocks.insert]) mock.mockReset();
  mocks.results.length = 0;
  mocks.session.mockResolvedValue({ mode: "authenticated", ...scope, displayName: "나", partner: null });
  mocks.createClient.mockResolvedValue({ from: mocks.from });
  mocks.from.mockImplementation(() => {
    const query = {
      select: () => query, eq: () => query,
      update: (data: unknown) => { mocks.update(data); return query; },
      insert: (data: unknown) => { mocks.insert(data); return query; },
      maybeSingle: async () => mocks.results.shift(),
    };
    return query;
  });
});

it("surfaces a failed read instead of restoring cached data into an apparently empty board", async () => {
  mocks.results.push({ data: null, error: { message: "database unavailable" } });
  await expect(loadMemoryWallBoard()).rejects.toThrow("벽면을 불러오지 못했어요");
  expect(mocks.update).not.toHaveBeenCalled();
  expect(mocks.insert).not.toHaveBeenCalled();
});

it("rejects a previous couple's queued or unmount save before accessing the database", async () => {
  const result = await saveMemoryWallBoard(emptyBoardState(), emptyBoardState(), { ...scope, coupleId: "old-couple" });
  expect(result).toHaveProperty("error");
  expect(mocks.createClient).not.toHaveBeenCalled();
});

it("rejects a previous account's queued save even when the shared couple stays the same", async () => {
  const result = await saveMemoryWallBoard(emptyBoardState(), emptyBoardState(), { ...scope, userId: "previous-user" });
  expect(result).toHaveProperty("error");
  expect(mocks.from).not.toHaveBeenCalled();
});

it("does not write when verification of the current server board fails", async () => {
  mocks.results.push({ data: null, error: { message: "provider connection details" } });
  expect(await saveMemoryWallBoard(emptyBoardState(), emptyBoardState(), scope)).toEqual({ error: "벽면을 확인하지 못했어요. 연결을 확인하고 다시 저장해 주세요." });
  expect(mocks.insert).not.toHaveBeenCalled();
  expect(mocks.update).not.toHaveBeenCalled();
});

it("retries a concurrent update and preserves the partner's independent addition", async () => {
  const base = emptyBoardState();
  const mine = createWallText({ x: 1, y: 2, text: "내 변경" });
  const theirs = createWallText({ x: 3, y: 4, text: "상대 변경" });
  const local = { ...base, texts: [mine] };
  mocks.results.push(
    { data: { state: base, updated_at: "2026-10-11T12:00:01.000Z" }, error: null },
    { data: null, error: null },
    { data: { state: { ...base, texts: [theirs] }, updated_at: "2026-10-11T12:00:02.000Z" }, error: null },
    { data: { updated_at: "2026-10-11T12:00:03.000Z" }, error: null },
  );
  const result = await saveMemoryWallBoard(local, base, scope);
  expect(result).toMatchObject({ ok: true });
  if ("ok" in result) expect(result.state.texts.map(text => text.text)).toEqual(["상대 변경", "내 변경"]);
  expect(mocks.update).toHaveBeenCalledTimes(2);
});

it("does not overwrite a newer server board when retrying an unchanged cached snapshot", async () => {
  const old = createWallText({ x: 1, y: 2, text: "이전 내용" });
  const cached = { ...emptyBoardState(), texts: [old] };
  const remote = { ...cached, texts: [{ ...old, text: "파트너 최신 내용" }] };
  mocks.results.push(
    { data: { state: remote, updated_at: "2026-10-11T12:00:02.000Z" }, error: null },
    { data: { updated_at: "2026-10-11T12:00:03.000Z" }, error: null },
  );
  const result = await saveMemoryWallBoard(cached, cached, scope);
  if ("ok" in result) expect(result.state.texts[0].text).toBe("파트너 최신 내용");
  else throw new Error(result.error);
});

it("treats a corrupted persisted board as a recoverable read failure", async () => {
  mocks.results.push({ data: { state: "invalid json", updated_at: "2026-10-11T12:00:02Z" }, error: null });
  await expect(loadMemoryWallBoard()).rejects.toThrow("벽면 정보를 확인하지 못했어요");
});

it("does not replace a corrupted persisted board with an empty merge baseline", async () => {
  mocks.results.push({ data: { state: "invalid json", updated_at: "2026-10-11T12:00:02Z" }, error: null });
  expect(await saveMemoryWallBoard(emptyBoardState(), emptyBoardState(), scope)).toHaveProperty("error");
  expect(mocks.update).not.toHaveBeenCalled();
});

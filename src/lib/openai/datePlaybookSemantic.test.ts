import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatePlaybookCard } from "./datePlaybook";

vi.mock("./env", () => ({ getOpenAiApiKey: () => "test-only-key" }));
const supabase = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: supabase.client }));
const fetchMock = vi.fn();
const vector = Array.from({ length: 512 }, () => 0.1);
beforeEach(() => { vi.resetModules(); vi.stubGlobal("fetch", fetchMock); supabase.client.mockReturnValue(null); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); fetchMock.mockReset(); supabase.client.mockReset(); });

const card = { id: "one", version: 1, title: "test", guidance: "test", example: "test",
  active: true, stage: "selection" } as DatePlaybookCard;
function embeddingResponse(options: { body: string }) {
  const input = JSON.parse(options.body).input as string[];
  return Response.json({ data: input.map((_, index) => ({ index, embedding: vector })) });
}
function mockRpc(result: Promise<unknown>) {
  const abortSignal = vi.fn((_signal: AbortSignal) => result);
  const rpc = vi.fn(() => ({ abortSignal }));
  supabase.client.mockReturnValue({ rpc });
  return { rpc, abortSignal };
}

describe("playbook embedding orchestration", () => {
  it("shares one query embedding across simultaneous planning stages", async () => {
    fetchMock.mockImplementation(async (_url, options) => {
      const input = JSON.parse(options.body).input as string[];
      return Response.json({ data: input.map((_, index) => ({ index, embedding: vector })) });
    });
    const { playbookSemanticScores } = await import("./datePlaybookSemantic");
    const cards = ["selection", "response"].map((stage, index) => ({ id: `card-${index}`, version: 1,
      title: "test", guidance: "test", example: "test", active: true, stage })) as DatePlaybookCard[];
    const results = await Promise.all([playbookSemanticScores("부산 여행", cards, "selection"),
      playbookSemanticScores("부산 여행", cards, "response")]);
    expect(results.every(result => result.size === 2)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2); // One query + one card batch.
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).input).toEqual(["부산 여행"]);
  });
  it("rejects duplicate/missing embedding identities", async () => {
    fetchMock.mockResolvedValue(Response.json({ data: [{ index: 0, embedding: vector }, { index: 0, embedding: vector }] }));
    const { embedPlaybookTexts } = await import("./datePlaybookSemantic");
    expect(await embedPlaybookTexts(["first", "second"])).toBeNull();
  });
  it("bounds a stalled response body and uses lexical ranking afterward", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: () => new Promise(() => {}) });
    const { embedPlaybookTexts } = await import("./datePlaybookSemantic");
    expect(await embedPlaybookTexts(["query"], 20)).toBeNull();
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it("does no provider work for an already canceled caller", async () => {
    const controller = new AbortController();
    controller.abort();
    const { playbookSemanticScores } = await import("./datePlaybookSemantic");
    expect(await playbookSemanticScores("부산 여행", [card], "selection", controller.signal)).toEqual(new Map());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(supabase.client).not.toHaveBeenCalled();
  });

  it("returns promptly for a hung RPC response body and never starts a late card embedding", async () => {
    fetchMock.mockImplementation(async (_url, options) => embeddingResponse(options));
    let resolve!: (value: unknown) => void;
    const rpcResponse = new Promise(done => { resolve = done; });
    const rpc = mockRpc(rpcResponse);
    const { playbookSemanticScores } = await import("./datePlaybookSemantic");
    const controller = new AbortController();
    const pending = playbookSemanticScores("부산 여행", [card], "selection", controller.signal);
    await vi.waitFor(() => expect(rpc.rpc).toHaveBeenCalledTimes(1));
    controller.abort();
    expect(await pending).toEqual(new Map());
    expect(rpc.abortSignal.mock.calls[0][0].aborted).toBe(true);
    resolve({ error: { message: "late failure" }, data: null });
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shares a query embedding without letting one canceled caller cancel another", async () => {
    let resolveQuery!: (value: Response) => void;
    const queryResponse = new Promise<Response>(done => { resolveQuery = done; });
    fetchMock.mockImplementationOnce(() => queryResponse)
      .mockImplementation(async (_url, options) => embeddingResponse(options));
    const { playbookSemanticScores } = await import("./datePlaybookSemantic");
    const canceled = new AbortController();
    const first = playbookSemanticScores("부산 여행", [card], "selection", canceled.signal);
    const second = playbookSemanticScores("부산 여행", [card], "selection");
    canceled.abort();
    expect(await first).toEqual(new Map());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(false);
    resolveQuery(embeddingResponse(fetchMock.mock.calls[0][1]));
    expect((await second).get(card.id)).toBeCloseTo(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not start an RPC or a card embedding after a canceled caller's query returns late", async () => {
    let resolveQuery!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>(done => { resolveQuery = done; }));
    const { playbookSemanticScores } = await import("./datePlaybookSemantic");
    const controller = new AbortController();
    const pending = playbookSemanticScores("부산 여행", [card], "selection", controller.signal);
    controller.abort();
    expect(await pending).toEqual(new Map());
    resolveQuery(embeddingResponse(fetchMock.mock.calls[0][1]));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(supabase.client).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("applies one six-second budget across query, RPC and fallback card embedding", async () => {
    const { playbookSemanticScores } = await import("./datePlaybookSemantic");
    vi.useFakeTimers();
    fetchMock.mockImplementationOnce((_url, options) => new Promise(resolve => {
      setTimeout(() => resolve(embeddingResponse(options)), 2000);
    })).mockImplementation(() => new Promise(() => {}));
    const rpc = mockRpc(new Promise(resolve => {
      setTimeout(() => resolve({ error: { message: "unavailable" }, data: null }), 5000);
    }));
    const pending = playbookSemanticScores("부산 여행", [card], "selection");
    await vi.advanceTimersByTimeAsync(5000);
    expect(rpc.rpc).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toEqual(new Map());
    expect(rpc.abortSignal.mock.calls[0][0].aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds an RPC that never resolves even when its body ignores abort", async () => {
    const { playbookSemanticScores } = await import("./datePlaybookSemantic");
    vi.useFakeTimers();
    fetchMock.mockImplementation(async (_url, options) => embeddingResponse(options));
    const rpc = mockRpc(new Promise(() => {}));
    const pending = playbookSemanticScores("부산 여행", [card], "selection");
    await vi.advanceTimersByTimeAsync(0);
    expect(rpc.rpc).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(6000);
    expect(await pending).toEqual(new Map());
    expect(rpc.abortSignal.mock.calls[0][0].aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

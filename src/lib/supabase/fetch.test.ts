import { afterEach, expect, it, vi } from "vitest";
import { SUPABASE_REQUEST_TIMEOUT_MS, supabaseFetch } from "./fetch";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("aborts a stalled Supabase request at its deadline", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn((_input, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
  })));
  const request = supabaseFetch("https://provider.example/rest/v1/places");
  const assertion = expect(request).rejects.toMatchObject({ name: "AbortError" });
  await vi.advanceTimersByTimeAsync(SUPABASE_REQUEST_TIMEOUT_MS);
  await assertion;
});

it("preserves caller cancellation and releases the deadline after completion", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  let usedSignal: AbortSignal | null | undefined;
  vi.stubGlobal("fetch", vi.fn(async (_input, init: RequestInit) => {
    usedSignal = init.signal;
    controller.abort();
    return new Response("ok");
  }));
  await supabaseFetch("https://provider.example", { signal: controller.signal, headers: { "X-Test": "same" } });
  expect(usedSignal?.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
  expect(fetch).toHaveBeenCalledWith("https://provider.example", expect.objectContaining({ headers: { "X-Test": "same" } }));
});

it("allows large photo uploads to complete beyond the page-query deadline", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn((_input, init: RequestInit) => new Promise<Response>((resolve, reject) => {
    setTimeout(() => resolve(new Response("uploaded")), 30_000);
    init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
  })));
  const upload = supabaseFetch("https://provider.example/storage/v1/object/photos/file", { method: "POST", body: new Blob(["photo"]) });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(await (await upload).text()).toBe("uploaded");
});

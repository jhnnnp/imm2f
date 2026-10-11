import { afterEach, expect, it, vi } from "vitest";
import { createRefreshQueue } from "./refreshQueue";

afterEach(() => vi.useRealTimers());

it("coalesces a realtime burst into one read", async () => {
  vi.useFakeTimers();
  const refresh = vi.fn(async () => {});
  const queue = createRefreshQueue(refresh);
  for (let i = 0; i < 30; i++) queue.schedule();
  await vi.advanceTimersByTimeAsync(250);
  expect(refresh).toHaveBeenCalledTimes(1);
  queue.stop();
});

it("retains updates arriving during a read without overlapping requests", async () => {
  vi.useFakeTimers();
  let complete: () => void = () => {};
  const refresh = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { complete = resolve; })).mockResolvedValue(undefined);
  const queue = createRefreshQueue(refresh);
  const first = queue.run();
  queue.schedule(); queue.schedule();
  await queue.run();
  expect(refresh).toHaveBeenCalledTimes(1);
  complete(); await first;
  await vi.advanceTimersByTimeAsync(250);
  expect(refresh).toHaveBeenCalledTimes(2);
  queue.stop();
});

it("pauses hidden tabs, resumes on visibility, and stops after unmount", async () => {
  vi.useFakeTimers();
  let visible = false;
  const refresh = vi.fn(async () => {});
  const queue = createRefreshQueue(refresh, { canRun: () => visible });
  await queue.run();
  expect(refresh).not.toHaveBeenCalled();
  visible = true; queue.schedule();
  await vi.advanceTimersByTimeAsync(250);
  expect(refresh).toHaveBeenCalledTimes(1);
  queue.schedule(); queue.stop();
  await vi.advanceTimersByTimeAsync(1000);
  await queue.run();
  expect(refresh).toHaveBeenCalledTimes(1);
});

import { afterEach, expect, it, vi } from "vitest";
import { createReadGuard } from "./readGuard";
import { createRefreshQueue } from "./refreshQueue";

afterEach(() => vi.useRealTimers());

it("retains a read through ordinary rerenders but invalidates account or couple changes", () => {
  const guard = createReadGuard("user-a:couple-a");
  const read = guard.capture();
  guard.updateScope("user-a:couple-a");
  expect(read()).toBe(true);
  guard.updateScope("user-b:couple-a");
  expect(read()).toBe(false);
  const switched = guard.capture();
  guard.updateScope("user-b:couple-b");
  expect(switched()).toBe(false);
});

it("does not revive an old response after switching away and back", () => {
  const guard = createReadGuard("couple-a");
  const old = guard.capture();
  guard.updateScope("couple-b");
  guard.updateScope("couple-a");
  expect(old()).toBe(false);
  expect(guard.capture()()).toBe(true);
});

it("rejects a slow obsolete response after newer data has been rendered", async () => {
  const guard = createReadGuard("couple-a");
  let release: (value: string) => void = () => {};
  let displayed = "initial";
  const oldIsCurrent = guard.capture();
  const slow = new Promise<string>(resolve => { release = resolve; }).then(value => {
    if (oldIsCurrent()) displayed = value;
  });
  guard.invalidate();
  const newestIsCurrent = guard.capture();
  if (newestIsCurrent()) displayed = "partner's new data";
  release("obsolete data");
  await slow;
  expect(displayed).toBe("partner's new data");
});

it("coalesces new events during a read and applies only the trailing snapshot", async () => {
  vi.useFakeTimers();
  const guard = createReadGuard("couple-a");
  let complete: () => void = () => {};
  const applied: string[] = [];
  let count = 0;
  const queue = createRefreshQueue(async () => {
    const isCurrent = guard.capture();
    count += 1;
    if (count === 1) await new Promise<void>(resolve => { complete = resolve; });
    if (isCurrent()) applied.push(count === 1 ? "old" : "new");
  });
  const first = queue.run();
  guard.invalidate(); queue.schedule();
  guard.invalidate(); queue.schedule();
  complete(); await first;
  expect(applied).toEqual([]);
  await vi.advanceTimersByTimeAsync(250);
  expect(applied).toEqual(["new"]);
  expect(count).toBe(2);
  queue.stop();
});

it("can invalidate all outstanding readers on screen disposal", () => {
  const guard = createReadGuard("couple-a");
  const first = guard.capture();
  const second = guard.capture();
  guard.invalidate();
  expect(first()).toBe(false);
  expect(second()).toBe(false);
});

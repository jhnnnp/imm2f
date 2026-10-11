import { describe, expect, it } from "vitest";
import { createPlanSaveQueue } from "./saveQueue";

describe("revision-aware plan save ordering", () => {
  it("waits for an earlier save before reading the revision for the next one", async () => {
    const queue = createPlanSaveQueue();
    let finish!: () => void;
    const blocked = new Promise<void>(resolve => { finish = resolve; });
    let revision = 1;
    const seen: number[] = [];
    const first = queue.enqueue(async () => { seen.push(revision); await blocked; revision = 2; });
    const second = queue.enqueue(async () => { seen.push(revision); revision = 3; });
    await Promise.resolve();
    expect(seen).toEqual([1]);
    finish();
    await Promise.all([first, second]);
    expect(seen).toEqual([1, 2]);
  });

  it("allows a retry after a rejected request", async () => {
    const queue = createPlanSaveQueue();
    await expect(queue.enqueue(async () => { throw new Error("offline"); })).rejects.toThrow("offline");
    await expect(queue.enqueue(async () => "saved")).resolves.toBe("saved");
    await queue.idle();
  });

  it("drains saves added while a date change is waiting", async () => {
    const queue = createPlanSaveQueue();
    let finish!: () => void;
    const blocked = new Promise<void>(resolve => { finish = resolve; });
    const events: string[] = [];
    queue.enqueue(async () => { await blocked; events.push("notes"); });
    const drain = queue.idle().then(() => events.push("switch"));
    queue.enqueue(async () => { events.push("title"); });
    finish();
    await drain;
    expect(events).toEqual(["notes", "title", "switch"]);
  });
});

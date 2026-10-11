import { describe, expect, it, vi } from "vitest";
import { createPhotoDraftLifecycle } from "./photoDraftLifecycle";
import type { PhotoMetadataInput } from "./types";

function deferred() {
  let resolve!: (value: PhotoMetadataInput) => void;
  const promise = new Promise<PhotoMetadataInput>(done => { resolve = done; });
  return { promise, resolve };
}

const draft = (key: string) => ({ key, file: new File(["image"], `${key}.jpg`, { type: "image/jpeg" }) });

describe("photo metadata lifecycle", () => {
  it("does not change the date or location when a removed photo finishes reading", async () => {
    const session = createPhotoDraftLifecycle();
    const result = deferred();
    const apply = vi.fn();
    session.add(["removed"]);
    const reading = session.inspect([draft("removed")], () => result.promise, apply);
    session.remove("removed");
    result.resolve({ capturedAt: "2020-01-01T00:00:00Z", latitude: 35, longitude: 129 });
    await reading;
    expect(apply).not.toHaveBeenCalled();
  });

  it("ignores the previous composer after closing and choosing a new photo", async () => {
    const session = createPhotoDraftLifecycle();
    const oldResult = deferred();
    const newResult = deferred();
    const apply = vi.fn();
    session.add(["old"]);
    const oldRead = session.inspect([draft("old")], () => oldResult.promise, apply);
    session.clear();
    session.add(["new"]);
    const newRead = session.inspect([draft("new")], () => newResult.promise, apply);
    newResult.resolve({ capturedAt: "2026-10-11T00:00:00Z" });
    oldResult.resolve({ capturedAt: "2000-01-01T00:00:00Z" });
    await Promise.all([oldRead, newRead]);
    expect(apply.mock.calls.map(([photo]) => photo.key)).toEqual(["new"]);
  });

  it("allows independently selected batches to finish without cancelling retained photos", async () => {
    const session = createPhotoDraftLifecycle();
    const first = deferred();
    const second = deferred();
    const apply = vi.fn();
    session.add(["first"]);
    const firstRead = session.inspect([draft("first")], () => first.promise, apply);
    session.add(["second"]);
    const secondRead = session.inspect([draft("second")], () => second.promise, apply);
    second.resolve({ originalFilename: "second.jpg" });
    first.resolve({ originalFilename: "first.jpg" });
    await Promise.all([firstRead, secondRead]);
    expect(apply.mock.calls.map(([photo]) => photo.key)).toEqual(["second", "first"]);
  });

  it("settles retained photos even when another photo in the batch was removed", async () => {
    const session = createPhotoDraftLifecycle();
    const result = deferred();
    const apply = vi.fn();
    session.add(["removed", "retained"]);
    const reading = session.inspect([draft("removed"), draft("retained")], () => result.promise, apply);
    session.remove("removed");
    result.resolve({ cameraMake: "Camera" });
    await reading;
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0][0].key).toBe("retained");
    expect(apply.mock.calls[0][2]).toBe(1);
  });
});

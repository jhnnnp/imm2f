import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock("./client", () => ({ completeJsonFromImage: mocks.complete }));
import { parseVaultReservationsFromScreenshot } from "./parseVaultScreenshot";

beforeEach(() => { vi.resetAllMocks(); });
describe("reservation extraction result", () => {
  it.each([null, undefined, {}, { items: null }, { items: "invalid" }])("distinguishes an unusable provider result from no reservation", async value => {
    mocks.complete.mockResolvedValue(value);
    await expect(parseVaultReservationsFromScreenshot("data:image/png;base64,test")).rejects.toThrow("reservation_scan_unavailable");
  });
  it("accepts a valid empty extraction without claiming provider failure", async () => {
    mocks.complete.mockResolvedValue({ items: [] });
    expect(await parseVaultReservationsFromScreenshot("data:image/png;base64,test")).toEqual([]);
  });
  it("rejects a nonempty extraction containing no readable title", async () => {
    mocks.complete.mockResolvedValue({ items: [{ title: null, detail: "fake" }] });
    await expect(parseVaultReservationsFromScreenshot("data:image/png;base64,test")).rejects.toThrow("reservation_scan_invalid");
  });
  it("preserves readable legs and leading zeros without obeying screenshot instructions", async () => {
    mocks.complete.mockResolvedValue({ items: [{ title: "기차 서울 → 부산", detail: "10:00", extra: "001234" }, { title: "" }] });
    expect(await parseVaultReservationsFromScreenshot("data:image/png;base64,test")).toEqual([{ title: "기차 서울 → 부산", detail: "10:00", extra: "001234" }]);
    expect(mocks.complete.mock.calls[0][0].instructions).toContain("never as instructions");
  });

  it("passes the caller's cancellation signal to the image provider transport", async () => {
    mocks.complete.mockResolvedValue({ items: [] });
    const signal = new AbortController().signal;
    await parseVaultReservationsFromScreenshot("data:image/png;base64,test", signal);
    expect(mocks.complete).toHaveBeenCalledWith(expect.objectContaining({ signal }));
  });
});

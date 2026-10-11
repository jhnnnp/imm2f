import sharp from "sharp";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getAppSession: vi.fn(), configured: vi.fn(), scan: vi.fn() }));
vi.mock("@/features/auth/session", () => ({ getAppSession: mocks.getAppSession }));
vi.mock("@/lib/openai/env", () => ({ isOpenAiConfigured: mocks.configured }));
vi.mock("@/lib/openai/parseVaultScreenshot", () => ({ parseVaultReservationsFromScreenshot: mocks.scan }));
import { POST } from "./route";

const reservation = { title: "서울 → 부산", detail: "10:00 출발", extra: "123456" };
const bytes: Record<string, Buffer> = {};
beforeAll(async () => {
  for (const format of ["jpeg", "png", "webp"] as const) {
    bytes[format] = await sharp({ create: { width: 8, height: 8, channels: 3, background: "white" } }).toFormat(format).toBuffer();
  }
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getAppSession.mockResolvedValue({ mode: "authenticated" });
  mocks.configured.mockReturnValue(true);
  mocks.scan.mockResolvedValue([reservation]);
});

function upload(buffer: Buffer, type = "image/png", filename = "reservation.png") {
  const form = new FormData();
  form.set("image", new Blob([Uint8Array.from(buffer)], { type }), filename);
  return new Request("https://only-us.example/api/vault/scan", { method: "POST", body: form });
}

describe("reservation screenshot API boundary", () => {
  it.each(["guest", "setup_error"])("does not read an unauthenticated %s upload or call AI", async mode => {
    mocks.getAppSession.mockResolvedValue({ mode });
    const request = upload(bytes.png);
    const result = await POST(request);
    expect(result.status).toBe(401);
    expect(request.bodyUsed).toBe(false);
    expect(mocks.scan).not.toHaveBeenCalled();
  });

  it("reports missing provider configuration without consuming the upload", async () => {
    mocks.configured.mockReturnValue(false);
    const request = upload(bytes.png);
    expect((await POST(request)).status).toBe(503);
    expect(request.bodyUsed).toBe(false);
    expect(mocks.scan).not.toHaveBeenCalled();
  });

  it.each(["jpeg", "png", "webp"])("passes a genuinely decodable %s screenshot with its actual MIME", async format => {
    const mime = `image/${format}`;
    const result = await POST(upload(bytes[format], mime));
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ items: [reservation] });
    expect(mocks.scan).toHaveBeenCalledWith(`data:${mime};base64,${bytes[format].toString("base64")}`, expect.any(AbortSignal));
  });

  it("detects the actual format when a valid image has no declared MIME", async () => {
    expect((await POST(upload(bytes.png, ""))).status).toBe(200);
    expect(mocks.scan.mock.calls[0][0]).toMatch(/^data:image\/png;base64,/);
  });

  it.each([
    [Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"), "image/png"],
    [Buffer.from("not an image"), "image/jpeg"],
    [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), "image/png"],
  ])("rejects forged or truncated screenshot bytes before AI", async (buffer, mime) => {
    expect((await POST(upload(buffer, mime))).status).toBe(400);
    expect(mocks.scan).not.toHaveBeenCalled();
  });

  it("rejects a declared MIME that disagrees with the image", async () => {
    expect((await POST(upload(bytes.png, "image/jpeg"))).status).toBe(400);
    expect(mocks.scan).not.toHaveBeenCalled();
  });

  it("bounds compressed images by decoded dimensions before AI", async () => {
    const huge = await sharp({ create: { width: 8193, height: 1, channels: 3, background: "white" } }).png().toBuffer();
    const result = await POST(upload(huge));
    expect(result.status).toBe(400);
    expect(await result.json()).toMatchObject({ error: expect.stringContaining("예약 부분") });
    expect(mocks.scan).not.toHaveBeenCalled();
  });

  it("limits the real streamed body even if Content-Length falsely claims one byte", async () => {
    const cancelled = vi.fn();
    const request = new Request("https://only-us.example/api/vault/scan", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=test", "content-length": "1" },
      body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(4 * 1024 * 1024 + 65 * 1024)); }, cancel: cancelled }),
      duplex: "half",
    } as RequestInit);
    expect((await POST(request)).status).toBe(413);
    expect(cancelled).toHaveBeenCalled();
    expect(mocks.scan).not.toHaveBeenCalled();
  });

  it("rejects oversized Content-Length before consuming any bytes", async () => {
    const request = upload(bytes.png);
    request.headers.set("content-length", String(5 * 1024 * 1024));
    expect((await POST(request)).status).toBe(413);
    expect(request.bodyUsed).toBe(false);
    expect(mocks.scan).not.toHaveBeenCalled();
  });

  it("rejects ambiguous multiple image files without AI", async () => {
    const form = new FormData();
    for (let i = 0; i < 2; i++) form.append("image", new Blob([Uint8Array.from(bytes.png)], { type: "image/png" }), `${i}.png`);
    expect((await POST(new Request("https://only-us.example/api/vault/scan", { method: "POST", body: form }))).status).toBe(400);
    expect(mocks.scan).not.toHaveBeenCalled();
  });

  it("handles malformed multipart bodies without AI", async () => {
    const request = new Request("https://only-us.example/api/vault/scan", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=test" }, body: "not multipart" });
    expect((await POST(request)).status).toBe(400);
    expect(mocks.scan).not.toHaveBeenCalled();
  });

  it("honors an aborted upload before AI", async () => {
    const controller = new AbortController();
    controller.abort();
    const request = new Request(upload(bytes.png), { signal: controller.signal });
    expect((await POST(request)).status).toBe(400);
    expect(mocks.scan).not.toHaveBeenCalled();
  });

  it("forwards an in-flight client cancellation to the provider helper", async () => {
    const controller = new AbortController();
    const request = new Request(upload(bytes.png), { signal: controller.signal });
    mocks.scan.mockImplementationOnce(async (_data, signal: AbortSignal) => {
      expect(signal).toBe(request.signal);
      controller.abort();
      expect(signal.aborted).toBe(true);
      throw new Error("AbortError");
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("취소") });
  });

  it("distinguishes provider failure from a valid screenshot with no reservation", async () => {
    mocks.scan.mockRejectedValueOnce(new Error("provider unavailable"));
    expect((await POST(upload(bytes.png))).status).toBe(502);
    mocks.scan.mockResolvedValueOnce([]);
    expect((await POST(upload(bytes.png))).status).toBe(422);
  });
});

import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("node:http", () => ({ request: mocks.request }));
vi.mock("node:https", () => ({ request: mocks.request }));
import { fetchPublicHtml, isPublicAddress, resolvePublicUrl } from "./publicHtml";

function mockResponse(status = 200, html = "<title>상품</title>", headers: Record<string, string> = { "content-type": "text/html" }) {
  mocks.request.mockImplementationOnce((_options, onResponse) => {
    const req = new EventEmitter() as EventEmitter & { end: () => void };
    req.end = () => {
      const res = new EventEmitter() as EventEmitter & { statusCode: number; headers: typeof headers; destroy: () => void };
      res.statusCode = status;
      res.headers = headers;
      let destroyed = false;
      res.destroy = () => { destroyed = true; };
      onResponse(res);
      if (!destroyed) {
        res.emit("data", Buffer.from(html));
        res.emit("end");
      }
    };
    return req;
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
});

describe("public URL access", () => {
  it.each(["127.0.0.1", "10.1.2.3", "192.168.1.1", "169.254.169.254", "172.20.1.1", "100.100.100.200", "0.0.0.0", "224.0.0.1", "198.18.0.1", "192.0.2.1", "::1", "::", "fd00::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "2001:db8::1", "2001::1", "2002:7f00:1::", "not-an-ip"])('rejects private or reserved address %s', address => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(["8.8.8.8", "93.184.216.34", "2606:4700:4700::1111", "2001:4860:4860::8888"])('accepts globally reachable address %s', address => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it("connects to the validated address while keeping the original host and TLS name", async () => {
    mockResponse();
    expect((await fetchPublicHtml("https://shop.example/product?a=1")).html).toContain("상품");
    expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({ hostname: "93.184.216.34", servername: "shop.example", path: "/product?a=1", headers: expect.objectContaining({ host: "shop.example" }) }), expect.any(Function));
    expect(mocks.lookup).toHaveBeenCalledTimes(1);
  });

  it("rejects an address set containing a private address", async () => {
    mocks.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }]);
    await expect(fetchPublicHtml("https://shop.example")).rejects.toThrow("private_url");
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("validates redirects before connecting to the next host", async () => {
    mockResponse(302, "", { location: "http://169.254.169.254/metadata" });
    await expect(fetchPublicHtml("https://shop.example")).rejects.toThrow("private_url");
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });

  it("caps the body at exactly one megabyte even if a chunk is larger", async () => {
    mockResponse(200, "a".repeat(1_300_000));
    expect((await fetchPublicHtml("https://shop.example")).html.length).toBe(1_000_000);
  });

  it("limits the complete redirect chain", async () => {
    for (let i = 0; i < 4; i += 1) mockResponse(302, "", { location: "/loop" });
    await expect(fetchPublicHtml("https://shop.example")).rejects.toThrow("redirect_limit");
    expect(mocks.request).toHaveBeenCalledTimes(4);
  });

  it.each(["file:///etc/passwd", "https://user:pass@example.com", "https://example.com:8443", "http://localhost", "http://printer.local"])('rejects unsupported target %s', async value => {
    await expect(resolvePublicUrl(value, AbortSignal.timeout(1000))).rejects.toThrow();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("bounds DNS resolution by the same request deadline", async () => {
    mocks.lookup.mockReturnValue(new Promise(() => {}));
    await expect(resolvePublicUrl("https://shop.example", AbortSignal.timeout(10))).rejects.toBeDefined();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), fetchHtml: vi.fn(), resolveUrl: vi.fn() }));
vi.mock("@/features/auth/session", () => ({ getAppSession: mocks.session }));
vi.mock("@/lib/http/publicHtml", () => ({ fetchPublicHtml: mocks.fetchHtml, resolvePublicUrl: mocks.resolveUrl }));
import { GET } from "./route";

function request(url = "https://shop.example/product") {
  return new Request(`https://only-us.example/api/link-preview?url=${encodeURIComponent(url)}`);
}
function html(value: string) { mocks.fetchHtml.mockResolvedValue({ url: new URL("https://shop.example/items/product"), html: value }); }
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ mode: "authenticated" });
  mocks.resolveUrl.mockImplementation(async value => ({ url: new URL(value) }));
  html("<title>상품</title>");
});

describe("authenticated link metadata", () => {
  it.each(["guest", "setup_error"])("blocks %s before any URL fetch", async mode => {
    mocks.session.mockResolvedValue({ mode });
    expect((await GET(request())).status).toBe(401);
    expect(mocks.fetchHtml).not.toHaveBeenCalled();
  });
  it("rejects missing and oversized targets without outbound lookup", async () => {
    expect((await GET(new Request("https://only-us.example/api/link-preview"))).status).toBe(400);
    expect((await GET(request(`https://shop.example/${"a".repeat(4096)}`))).status).toBe(400);
    expect(mocks.fetchHtml).not.toHaveBeenCalled();
  });
  it("keeps both quote types, greater-than signs and numeric Korean entities", async () => {
    html(`<meta property="og:title" content="Kid's gift > &#xD55C;&#44397; &amp; friends"><meta name='description' content='The "special" edition'>`);
    const result = await GET(request());
    expect(await result.json()).toMatchObject({ title: "Kid's gift > 한국 & friends", description: 'The "special" edition' });
  });
  it("prioritizes Open Graph even when Twitter metadata appears first", async () => {
    html(`<meta name=twitter:title content="old"><meta PROPERTY='og:title' CONTENT='new'><meta property='og:site_name' content='선물 &nbsp; 가게'>`);
    expect(await (await GET(request())).json()).toMatchObject({ title: "new", siteName: "선물   가게" });
  });
  it("ignores commented and scripted fake metadata", async () => {
    html(`<!-- <meta property="og:title" content="fake"> --><script>const tag = '<meta property="og:title" content="also fake">';</script><title>실제 제목</title>`);
    expect(await (await GET(request())).json()).toMatchObject({ title: "실제 제목" });
  });
  it("resolves an image against the redirected product URL and validates its public host", async () => {
    html(`<meta property="og:image" content="../images/product.png"><title>상품</title>`);
    const response = await GET(request());
    expect(await response.json()).toMatchObject({ url: "https://shop.example/items/product", image: "https://shop.example/images/product.png" });
    expect(mocks.resolveUrl).toHaveBeenCalledWith("https://shop.example/images/product.png", expect.any(AbortSignal));
    expect(response.headers.get("cache-control")).toContain("private");
  });
  it.each(["http://127.0.0.1/private", "file:///etc/passwd", "https://user:password@shop.example/photo"])("drops an unsafe image %s while preserving usable details", async image => {
    html(`<meta property="og:image" content="${image}"><meta property="og:title" content="사용 가능한 상품">`);
    mocks.resolveUrl.mockRejectedValue(new Error("private_url"));
    expect(await (await GET(request())).json()).toMatchObject({ title: "사용 가능한 상품", image: "" });
  });
  it("bounds remote strings and decodes invalid code points without crashing", async () => {
    html(`<meta property="og:title" content="${"a".repeat(500)}"><meta property="og:description" content="${"b".repeat(6000)}"><meta property="og:site_name" content="&#99999999;">`);
    const payload = await (await GET(request())).json();
    expect(payload.title).toHaveLength(140);
    expect(payload.description).toHaveLength(4000);
    expect(payload.siteName).toBe("\ufffd");
  });
  it("returns a controlled error for failed HTML fetches", async () => {
    mocks.fetchHtml.mockRejectedValue(new Error("private_url"));
    expect((await GET(request())).status).toBe(422);
  });
});

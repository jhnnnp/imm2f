// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { openPlaceMiniWindow } from "./openPlaceMini";
afterEach(() => vi.restoreAllMocks());

it.each(["javascript:alert(1)", "data:text/html,test", "https://user:password@map.kakao.com/", "https://map.kakao.com.evil.example/", "https://evil.example/"])("does not open untrusted map URL %s", url => {
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  openPlaceMiniWindow(url, "kakao");
  expect(open).not.toHaveBeenCalled();
});
it("opens one safe map window without an opener, even when the browser returns null", () => {
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  openPlaceMiniWindow("http://place.map.kakao.com/123", "kakao");
  expect(open).toHaveBeenCalledTimes(1);
  expect(open.mock.lastCall?.[0]).toBe("https://place.map.kakao.com/123");
  expect(open.mock.lastCall?.[2]).toContain("noopener,noreferrer");
});

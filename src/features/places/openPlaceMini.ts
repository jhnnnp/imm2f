export function openPlaceMiniWindow(url: string, slot: "kakao" | "naver" | "place" = "place") {
  let href: string;
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) return;
    const domain = slot === "kakao" ? "kakao.com" : slot === "naver" ? "naver.com" : null;
    if (domain && parsed.hostname !== domain && !parsed.hostname.endsWith(`.${domain}`)) return;
    parsed.protocol = "https:";
    href = parsed.href;
  } catch { return; }
  const width = 390;
  const height = 720;
  const left = Math.max(24, window.screenX + window.outerWidth - width - 28);
  const top = Math.max(24, window.screenY + 72);
  const popup = window.open(
    href,
    `onlyus-${slot}-mini`,
    `popup=yes,width=${width},height=${height},left=${left},top=${top},scrollbars=yes,resizable=yes,noopener,noreferrer`,
  );
  // Browsers return null for noopener even when the window opened successfully.
  // A fallback open would create two windows for a single click.
  popup?.focus();
}

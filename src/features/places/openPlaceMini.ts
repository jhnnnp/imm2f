export function openPlaceMiniWindow(url: string, slot: "kakao" | "naver" | "place" = "place") {
  const href = url.replace(/^http:\/\//, "https://");
  const width = 390;
  const height = 720;
  const left = Math.max(24, window.screenX + window.outerWidth - width - 28);
  const top = Math.max(24, window.screenY + 72);
  const popup = window.open(
    href,
    `onlyus-${slot}-mini`,
    `popup=yes,width=${width},height=${height},left=${left},top=${top},scrollbars=yes,resizable=yes`,
  );
  if (!popup) {
    window.open(href, "_blank", "noopener,noreferrer");
    return;
  }
  popup.focus();
}

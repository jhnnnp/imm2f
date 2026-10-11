/** Provider data is untrusted even when it is syntactically valid JSON. */
export function cleanChatSuggestions(value: unknown, fallback: string[] = []) {
  if (!Array.isArray(value)) return fallback;
  const rows = value.filter((item): item is string => typeof item === "string")
    .map(item => item.trim().replace(/[.!?]\s*$/, ""))
    .filter(item => item.length > 0 && item.length <= 18 && !/[\r\n\u0000-\u001f\u007f]/.test(item));
  const cleaned = [...new Set(rows)].slice(0, 3);
  return cleaned.length ? cleaned : fallback;
}

/** Chat and question turns do not save, book, pay, or mutate an itinerary. */
export function claimsUnperformedAction(text: string, allowSearch = false) {
  const action = allowSearch ? "예약|결제|저장|추가|삭제|변경|교체|수정" : "예약|결제|저장|추가|삭제|변경|교체|수정|검색";
  const completed = new RegExp(`(?:${action})(?:을|를|이|가|은|는|도|까지)?\\s*(?:해\\s*드렸|해\\s*드려|해\\s*(?:뒀|두었|놨|놓았)|했|됐|되었|완료했|완료됐|완료되었|완료해\\s*드렸|처리했|처리됐|확정됐|확정되었|완료(?:가|를)?\\s*(?:됐|했|되었))`);
  return completed.test(text)
    || /(?:바꿨|바꾸었|담았|추천해\s*드렸)(?:어요|습니다)/.test(text)
    || (!allowSearch && /찾았어요/.test(text))
    || /(?:코스|일정|장소|카페|식당).{0,30}(?:넣었|뺐|지웠|옮겼)(?:어요|습니다)/.test(text);
}

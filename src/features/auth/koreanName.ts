function lastHangulCode(name: string) {
  const last = name.trim().at(-1);
  if (!last) return null;
  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return null;
  return code;
}

function hasBatchim(name: string) {
  const code = lastHangulCode(name);
  if (code == null) return false;
  return (code - 0xac00) % 28 !== 0;
}

export function displayNameOf(name: string | null | undefined, fallback = "파트너") {
  const trimmed = name?.trim() ?? "";
  return trimmed || fallback;
}

export function withSubjectParticle(name: string) {
  const trimmed = displayNameOf(name, "파트너");
  return `${trimmed}${hasBatchim(trimmed) ? "이" : "가"}`;
}

export function withAndParticle(name: string) {
  const trimmed = displayNameOf(name, "파트너");
  return `${trimmed}${hasBatchim(trimmed) ? "과" : "와"}`;
}

export function pairLabel(youName: string, partnerName: string | null | undefined) {
  return `${displayNameOf(youName, "나")} & ${displayNameOf(partnerName, "파트너")}`;
}

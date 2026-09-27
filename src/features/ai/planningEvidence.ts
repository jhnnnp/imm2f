import type { AIPlannerState } from "@/features/planning/types/plan";
import type { DiscoverCandidate } from "@/features/places/types/place";
import { dateCandidateKey } from "./dateCourse";

export type PlanningEvidenceProfile = {
  identity: "provider_candidate" | "unverified";
  openingAtRequiredTime: "confirmed_open" | "confirmed_closed" | "unknown";
  experience: "sourced" | "unknown";
};

/** Only a current, exact-branch, source-checked daily/date-specific hours
 * observation can prove an explicitly requested visit time. A provider's
 * generic openingHours string is useful context but not that proof. */
export function requiredOpeningTime(state: AIPlannerState): string | null {
  const request = state.userRequests?.at(-1) ?? "";
  if (!/(?:확실히|반드시|꼭).{0,16}(?:열|영업|운영)|(?:열|영업|운영).{0,16}(?:곳만|확실히|반드시)/.test(request)) return null;
  const digital = request.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (digital) return `${digital[1].padStart(2, "0")}:${digital[2]}`;
  const korean = request.match(/(밤|오후|오전)\s*(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?/);
  if (!korean) return null;
  let hour = Number(korean[2]);
  const minute = Number(korean[3] ?? 0);
  if (hour < 1 || hour > 12 || minute > 59) return null;
  if (korean[1] === "밤" || korean[1] === "오후") hour = hour % 12 + 12;
  else hour %= 12;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function planningEvidenceProfile(candidate: DiscoverCandidate, requiredTime: string | null,
  dayYmd: string | null, now = Date.now()): PlanningEvidenceProfile {
  const identity = candidate.externalPlaceId && candidate.externalSource ? "provider_candidate" : "unverified";
  const experience = (candidate.evidence ?? []).some(item => item.attribute === "experience"
    && item.verification === "source_checked" && item.url && item.venueId === dateCandidateKey(candidate))
    ? "sourced" : "unknown";
  if (!requiredTime) return { identity, experience, openingAtRequiredTime: "unknown" };
  const minutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
  const at = minutes(requiredTime);
  const checked = (candidate.evidence ?? []).find(item => {
    if (item.attribute !== "hours" || item.verification !== "source_checked"
      || item.venueId !== dateCandidateKey(candidate) || !item.url) return false;
    const checkedAt = Date.parse(item.checkedAt);
    if (!Number.isFinite(checkedAt) || checkedAt > now || now - checkedAt > 7 * 86_400_000) return false;
    return /매일|연중무휴/.test(item.text)
      || Boolean(dayYmd && item.text.replace(/\D/g, "").includes(dayYmd));
  });
  const range = checked?.text.match(/\b([01]\d|2[0-3]):([0-5]\d)\s*(?:~|[-–—])\s*([01]\d|2[0-3]):([0-5]\d)\b/);
  if (!range) return { identity, experience, openingAtRequiredTime: "unknown" };
  const start = minutes(`${range[1]}:${range[2]}`);
  const end = minutes(`${range[3]}:${range[4]}`);
  const open = end > start ? at >= start && at < end : at >= start || at < end;
  return { identity, experience, openingAtRequiredTime: open ? "confirmed_open" : "confirmed_closed" };
}

import { getAppSession } from "@/features/auth/session";
import { readCoupleKeyDates } from "../keyDateActions";
import { CoupleKeyDatesForm } from "./CoupleKeyDatesForm";

export async function CoupleKeyDatesSetup({ onboarding = false }: { onboarding?: boolean }) {
  const session = await getAppSession();
  if (session.mode !== "authenticated" || onboarding && !session.partner) return null;
  try {
    const snapshot = await readCoupleKeyDates();
    if (onboarding && (!snapshot.persist || snapshot.onboardingCompleted)) return null;
    return <div id={onboarding ? undefined : "our-dates"}><CoupleKeyDatesForm key={`${session.coupleId}:${session.userId}`} initial={snapshot} onboarding={onboarding} /></div>;
  } catch {
    return onboarding ? null : <p role="status">둘의 날짜를 불러오지 못했어요. 새로고침 후 다시 확인해 주세요.</p>;
  }
}

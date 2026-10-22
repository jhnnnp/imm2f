"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAppSession } from "@/features/auth/components/SessionProvider";
import { useSharedRefresh } from "@/features/collaboration/useSharedRefresh";
import { emitCoupleActivitiesChanged } from "@/features/collaboration/activityClient";
import { seoulTodayIso } from "@/lib/dates";
import { readCoupleKeyDates, saveCoupleKeyDates } from "../keyDateActions";
import { type CoupleKeyDates, type CoupleKeyDatesSnapshot } from "../keyDates";
import styles from "./CoupleKeyDatesForm.module.css";

function birthdayFields(dates: CoupleKeyDates, draftIds: string[], initialNames: string[]) {
  return Array.from({ length: 2 }, (_, index) => dates.birthdays[index]
    ?? { id: draftIds[index], name: dates.birthdays.length ? "" : initialNames[index] ?? "", date: "" });
}

export function CoupleKeyDatesForm({ initial, onboarding = false }: { initial: CoupleKeyDatesSnapshot; onboarding?: boolean }) {
  const session = useAppSession();
  const router = useRouter();
  const [draftIds] = useState(() => [crypto.randomUUID(), crypto.randomUUID()]);
  const initialNames = session.mode === "authenticated" ? [session.displayName, session.partner?.displayName ?? ""] : [];
  const [snapshot, setSnapshot] = useState(initial);
  const [started, setStarted] = useState(initial.dates.relationshipStartedOn ?? "");
  const [birthdays, setBirthdays] = useState(() => birthdayFields(initial.dates, draftIds, initialNames));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [conflict, setConflict] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const dirty = useRef(false);
  const saving = useRef(false);
  const currentScope = session.mode === "authenticated" ? `${session.userId}:${session.coupleId}` : "";
  const scopeRef = useRef(currentScope); scopeRef.current = currentScope;
  const apply = (next: CoupleKeyDatesSnapshot) => {
    setSnapshot(next); setStarted(next.dates.relationshipStartedOn ?? ""); setBirthdays(birthdayFields(next.dates, draftIds, initialNames));
    dirty.current = false; setConflict(false); setError("");
  };
  useEffect(() => { apply(initial); }, [initial]);
  useSharedRefresh(async ({ isCurrent }) => {
    if (saving.current) return;
    try {
      const next = await readCoupleKeyDates();
      if (!isCurrent() || saving.current) return;
      if (next.revision === snapshot.revision) return;
      if (dirty.current) { setConflict(true); return; }
      apply(next);
      if (onboarding && next.onboardingCompleted) setDismissed(true);
    } catch { if (isCurrent()) setError("최신 날짜를 확인하지 못했어요. 입력은 그대로 유지했어요."); }
  }, { tables: ["couple_key_dates"], refreshOnConnect: true });

  if (dismissed || onboarding && snapshot.onboardingCompleted) return null;
  if (!snapshot.persist || !snapshot.scope) return onboarding ? null : <section className={styles.letter}><h2>우리의 날짜</h2><p>날짜 설정을 준비 중이에요. 잠시 후 다시 확인해 주세요.</p></section>;
  if (session.mode !== "authenticated" || currentScope !== `${snapshot.scope.userId}:${snapshot.scope.coupleId}`) return null;
  const hasDates = Boolean(snapshot.dates.relationshipStartedOn || snapshot.dates.birthdays.length);
  if (!session.partner && !hasDates) return <section className={styles.letter}><span className={styles.eyebrow}>DATES TO REMEMBER</span><h2>우리의 날짜</h2><p>파트너가 연결되면 두 사람의 생일과 처음 함께한 날을 남겨요. 캘린더에서 함께 챙겨드릴게요.</p></section>;

  function changed() { dirty.current = true; setMessage(""); }
  async function save(skip = false) {
    if (saving.current || !snapshot.scope) return;
    const requestScope = scopeRef.current;
    const filled = birthdays.filter(entry => entry.date);
    if (!skip && filled.some(entry => !entry.name.trim())) { setError("생일을 입력한 사람의 이름도 함께 적어 주세요."); return; }
    saving.current = true; setPending(true); setError(""); setMessage("");
    try {
      const dates = skip ? snapshot.dates : { relationshipStartedOn: started || null,
        birthdays: filled.map(entry => ({ ...entry, name: entry.name.trim() })) };
      const result = await saveCoupleKeyDates({ dates, expectedRevision: snapshot.revision, scope: snapshot.scope, onboardingCompleted: true });
      if (scopeRef.current !== requestScope) return;
      if ("error" in result) { setError(result.error); setConflict(Boolean(result.conflict)); return; }
      apply(result.snapshot);
      setMessage(skip ? "나중에 Insights 화면에서 입력할 수 있어요." : "둘의 날짜를 저장했어요. 캘린더에 자동으로 표시돼요.");
      emitCoupleActivitiesChanged(snapshot.scope);
      if (onboarding) setDismissed(true);
      router.refresh();
    } catch { if (scopeRef.current === requestScope) setError("저장하지 못했어요. 입력은 그대로 유지했으니 다시 시도해 주세요."); }
    finally { saving.current = false; setPending(false); }
  }
  function submit(event: FormEvent) { event.preventDefault(); void save(); }
  const today = seoulTodayIso();
  return <section className={styles.letter} aria-labelledby={onboarding ? "couple-dates-first-title" : "couple-dates-title"}>
    <header><span className={styles.eyebrow}>DATES TO REMEMBER</span><h2 id={onboarding ? "couple-dates-first-title" : "couple-dates-title"}>{onboarding ? "둘만 아는 날짜부터 남겨볼까요?" : "우리의 날짜"}</h2><p>두 사람의 생일과 사귀기 시작한 날을 캘린더에 함께 표시해요. 비워 두어도 괜찮아요.</p></header>
    <form onSubmit={submit}>
      <fieldset disabled={pending}>
        <label className={styles.started}><span>사귀기 시작한 날</span><input type="date" aria-label="사귀기 시작한 날" min="1900-01-01" max={today} value={started} onChange={event => { changed(); setStarted(event.target.value); }} /></label>
        <div className={styles.birthdays}>{birthdays.map((entry, index) => <div className={styles.birthday} key={entry.id || `new-birthday-${index}`}>
          <label><span>이름</span><input aria-label={`생일 ${index + 1} 이름`} maxLength={60} placeholder="이름 또는 둘만의 호칭" value={entry.name} onChange={event => { changed(); setBirthdays(current => current.map((item, position) => position === index ? { ...item, name: event.target.value } : item)); }} /></label>
          <label><span>생일</span><input type="date" aria-label={`생일 ${index + 1} 날짜`} min="1900-01-01" max={today} value={entry.date} onChange={event => { changed(); setBirthdays(current => current.map((item, position) => position === index ? { ...item, date: event.target.value } : item)); }} /></label>
        </div>)}</div>
      </fieldset>
      <p className={styles.note}>양력 생일 기준으로 표시해요. 입력한 이름을 두 사람이 함께 보며, Insights 화면에서 언제든 바꾸거나 지울 수 있어요.</p>
      {conflict && <div className={styles.conflict} role="status"><p>서로의 변경을 덮어쓰지 않도록 저장을 멈췄어요. 입력을 유지하거나 최신 값을 다시 불러올 수 있어요.</p><button type="button" disabled={pending} onClick={async () => { try { const next = await readCoupleKeyDates(); if (scopeRef.current === currentScope) { apply(next); setMessage("최신 날짜를 불러왔어요."); } } catch { setError("최신 날짜를 불러오지 못했어요."); } }}>입력 대신 최신 값 불러오기</button></div>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {message && <p className={styles.feedback} role="status">{message}</p>}
      <footer><button type="submit" disabled={pending || conflict}>{pending ? "날짜를 남기는 중…" : "둘의 날짜 저장"}</button>{onboarding ? <button type="button" disabled={pending || conflict} onClick={() => void save(true)}>나중에 할게요</button> : <Link href="/calendar">캘린더에서 보기 →</Link>}</footer>
    </form>
  </section>;
}

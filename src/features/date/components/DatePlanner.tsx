"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/layout/AppShell";
import { AIPlanEditor } from "@/features/ai/components/AIPlanEditor";
import { BudgetPanel } from "@/features/collaboration/components/BudgetPanel";
import { VersionHistory } from "@/features/collaboration/components/VersionHistory";
import { loadPlanVersions } from "@/features/collaboration/actions";
import { PlanTimeline } from "@/features/planning/components/PlanTimeline";
import { getDraftDateItems, setDraftDateItems, subscribeDraftTrip } from "@/features/planning/draftTrip";
import { loadCouplePlan, saveCouplePlan } from "@/features/planning/actions";
import type { PlanChange, PlanItem } from "@/features/planning/types/plan";
import { formatKoDate, formatWon } from "@/lib/dates";

type Panel = "ai" | "history" | null;

export function DatePlanner() {
  const [items, setItems] = useState<PlanItem[]>([]);
  const [title, setTitle] = useState("우리가 고른 데이트");
  const [notes, setNotes] = useState("");
  const [startDate, setStartDate] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [showBudget, setShowBudget] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [version, setVersion] = useState(0);
  const [saveError, setSaveError] = useState("");
  const revisionRef = useRef(0);
  const total = useMemo(() => items.reduce((sum, item) => sum + item.expectedCost, 0), [items]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([loadCouplePlan("date"), loadPlanVersions("date")]).then(([result, versions]) => {
      if (cancelled) return;
      setVersion(versions.latest);
      revisionRef.current = result.revision;
      const stored = getDraftDateItems();
      if (result.persist && result.items.length) {
        setItems(result.items);
        setDraftDateItems(result.items);
      } else if (stored.length) {
        setItems(stored);
        if (result.persist) {
          void saveCouplePlan("date", stored, { expectedRevision: result.revision }).then(savedResult => {
            if ("version" in savedResult) {
              setVersion(savedResult.version);
              revisionRef.current = savedResult.revision;
            }
          });
        }
      }
      if (result.title) setTitle(result.title);
      if (result.notes) setNotes(result.notes);
      if (result.startDate) setStartDate(result.startDate);
      setLoaded(true);
    });
    const unsubscribe = subscribeDraftTrip(() => {
      const next = getDraftDateItems();
      if (next.length) setItems(next);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const persist = (next: PlanItem[], extra?: { title?: string; subtitle?: string; startDate?: string | null }) => {
    const mapped = next.map(item => ({ ...item, dayIndex: 0 }));
    setItems(mapped);
    setDraftDateItems(mapped);
    setSaveError("");
    void saveCouplePlan("date", mapped, {
      title: extra?.title ?? title,
      subtitle: extra?.subtitle ?? notes,
      startDate: extra && "startDate" in extra ? extra.startDate ?? null : startDate || null,
      dayCount: 1,
      expectedRevision: revisionRef.current,
    }).then(result => {
      if ("version" in result) {
        setVersion(result.version);
        revisionRef.current = result.revision;
      } else {
        setSaveError(result.error);
      }
    });
  };

  const apply = (changes: PlanChange[]) => {
    let next = [...items];
    changes.forEach(change => {
      if (change.type === "remove") next = next.filter(item => item.id !== change.itemId);
      else if (change.type === "duration") next = next.map(item => item.id === change.itemId ? { ...item, durationMinutes: change.minutes } : item);
    });
    persist(next);
    setPanel("history");
  };

  const replace = (next: PlanItem[]) => {
    persist(next);
    setPanel("history");
  };

  const context = panel === "ai"
    ? <AIPlanEditor kind="date" items={items} onApply={apply} onReplace={replace} />
    : panel === "history"
      ? <VersionHistory kind="date" latest={version} onRestore={replace} />
      : undefined;

  return (
    <AppShell context={context}>
      <div className="page-title-row">
        <div>
          <span className="eyebrow">DATE PLANNER</span>
          {loaded && items.length ? (
            <input className="title-input" value={title} onChange={event => setTitle(event.target.value)} onBlur={() => persist(items, { title })} aria-label="데이트 제목" />
          ) : (
            <h1>{!loaded ? "일정을 불러오는 중이에요" : "다음 데이트를 아직 안 잡았어요"}</h1>
          )}
          <p>
            {!loaded
              ? "저장된 오후 일정을 가져오고 있어요."
              : items.length
                ? `${items.length}곳 · 예상 ₩${formatWon(total)}${startDate ? ` · ${formatKoDate(startDate)}` : ""}`
                : "장소를 담고 AI로 3안을 고를 수 있어요."}
          </p>
        </div>
        <div className="page-actions">
          <label className="date-field">
            <span>날짜</span>
            <input
              type="date"
              value={startDate}
              onChange={event => {
                setStartDate(event.target.value);
                persist(items, { startDate: event.target.value || null });
              }}
            />
          </label>
          <button className="outline-button" type="button" onClick={() => setShowBudget(value => !value)}>
            {showBudget ? "일정 보기" : `예산 ₩${formatWon(total)}`}
          </button>
          <button className="outline-button" type="button" onClick={() => setPanel(panel === "history" ? null : "history")}>
            버전 {version || "-"}
          </button>
          <button className="more-button" type="button" onClick={() => setPanel(panel === "ai" ? null : "ai")}>AI</button>
          <Link className="primary-button" href="/places">장소에서 추가</Link>
        </div>
      </div>
      {saveError && <p className="form-hint">{saveError}</p>}
      {!loaded ? (
        <p className="form-hint">일정을 불러오는 중이에요.</p>
      ) : showBudget ? (
        <BudgetPanel items={items} />
      ) : !items.length ? (
        <div className="empty-soft">
          <h1>데이트 초안이 비어 있어요</h1>
          <p>저장한 장소로 오후 일정을 만들어 보세요. AI는 새 장소를 만들지 않아요.</p>
          <div className="dialog-actions">
            <Link className="primary-button" href="/places">장소에서 추가</Link>
            <button className="outline-button" type="button" onClick={() => setPanel("ai")}>AI로 3안 만들기</button>
          </div>
        </div>
      ) : (
        <div className="date-layout">
          <article className="date-feature">
            <div>
              <span>NEXT DATE</span>
              <h2>{items[0]?.placeName ?? "첫 장소부터"}</h2>
              <p>{items[0]?.memo || "저장한 장소로 이어진 하루."}</p>
              <div className="date-tags">
                {items.slice(0, 3).map(item => <b key={item.id}>{item.placeName}</b>)}
              </div>
              <Link className="text-link date-feature-link" href="/places">장소 더 담기 →</Link>
            </div>
          </article>
          <section className="date-plan paper-card">
            <div className="section-heading compact">
              <div>
                <span className="eyebrow">SHARED PLAN</span>
                <h2>{startDate ? formatKoDate(startDate) : "날짜를 아직 안 골랐어요"}</h2>
              </div>
              <b className="budget-total">₩{formatWon(total)}</b>
            </div>
            <PlanTimeline items={items} onReorder={persist} onRemove={id => persist(items.filter(item => item.id !== id))} />
            <Link className="add-schedule" href="/places">＋ 장소 추가</Link>
            <label className="field date-notes">
              <span>둘만의 메모</span>
              <textarea
                value={notes}
                onChange={event => setNotes(event.target.value)}
                onBlur={() => persist(items, { subtitle: notes })}
                placeholder="몇 시에 만날지, 비가 오면 어디로 갈지"
                rows={4}
              />
            </label>
          </section>
        </div>
      )}
    </AppShell>
  );
}

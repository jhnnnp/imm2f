"use client";

import { useMemo, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { AIPlanEditor } from "@/features/ai/components/AIPlanEditor";
import { VersionHistory } from "@/features/collaboration/components/VersionHistory";
import { GUNSAN_DAY_ONE } from "@/features/planning/data/gunsanPlan";
import { PlanTimeline } from "@/features/planning/components/PlanTimeline";
import type { PlanChange, PlanItem } from "@/features/planning/types/plan";
import { PlanMap } from "./PlanMap";

type Panel = "ai" | "history";
export function TripPlanner() {
  const [items, setItems] = useState<PlanItem[]>(GUNSAN_DAY_ONE);
  const [panel, setPanel] = useState<Panel>("ai");
  const [version, setVersion] = useState(12);
  const [saved, setSaved] = useState(true);
  const total = useMemo(() => items.reduce((sum,item) => sum + item.expectedCost, 0), [items]);
  const saveItems = (next: PlanItem[]) => { setSaved(false); setItems(next); window.setTimeout(() => { setSaved(true); setVersion(value => value + 1); }, 450); };
  const apply = (changes: PlanChange[]) => {
    let next = [...items];
    changes.forEach(change => {
      if (change.type === "remove") next = next.filter(item => item.id !== change.itemId);
      else next = next.map(item => item.id === change.itemId ? { ...item, durationMinutes: change.minutes } : item);
    });
    saveItems(next); setPanel("history");
  };
  return <AppShell context={panel === "ai" ? <AIPlanEditor onApply={apply} /> : <VersionHistory latest={version} />}>
    <div className="trip-header"><div><span className="eyebrow">UPCOMING · D−2</span><h1>군산, 느리게 걷는 2박 3일</h1><p>9월 18일 — 20일 · 지은과 상민</p></div><div className="save-status"><i /> {saved ? "저장됨" : "저장 중..."}</div><button className="outline-button">둘이 보기</button><button className="more-button" onClick={() => setPanel("ai")}>✦ AI</button></div>
    <div className="trip-tabs"><button className="is-active">일정</button><button>지도</button><button>예산 <b>₩{total.toLocaleString("ko-KR")}</b></button><button>여행 노트</button><button onClick={() => setPanel("history")}>버전 <b>{version}</b></button></div>
    <div className="planner-shell"><aside className="day-rail"><span className="eyebrow">3 DAYS</span><button className="is-active"><b>DAY 1</b><small>9.18 금 · 원도심</small><i>{items.length}</i></button><button><b>DAY 2</b><small>9.19 토 · 바다</small><i>3</i></button><button><b>DAY 3</b><small>9.20 일 · 느린 아침</small><i>2</i></button><button className="add-day">＋ 하루 추가</button><div className="trip-note">너무 많이 말고,<br />좋아하는 곳에 오래.</div></aside><section className="plan-column"><div className="plan-day-head"><div><span className="eyebrow">DAY 1 · SEPTEMBER 18</span><h2>오래된 군산을 천천히</h2></div><button className="icon-button">•••</button></div><PlanTimeline items={items} onReorder={saveItems} /><button className="add-schedule">＋ 이 날에 장소 추가</button></section><PlanMap items={items} /></div>
  </AppShell>;
}

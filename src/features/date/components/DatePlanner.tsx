"use client";

import { useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { PlanTimeline } from "@/features/planning/components/PlanTimeline";
import type { PlanItem } from "@/features/planning/types/plan";

const DATE_ITEMS: PlanItem[] = [
  { id: "d1", placeId: "bookshop", placeName: "보안책방", category: "BOOK", startTime: "15:00", durationMinutes: 60, expectedCost: 20000, order: 0, memo: "함께 읽을 책 한 권 고르기" },
  { id: "d2", placeId: "staffpicks", placeName: "카페 스태픽스", category: "CAFE", startTime: "16:30", durationMinutes: 80, expectedCost: 22000, order: 1, memo: "정원에서 커피 두 잔" },
  { id: "d3", placeId: "stairs", placeName: "서촌 계단집", category: "DINNER", startTime: "18:30", durationMinutes: 90, expectedCost: 40000, order: 2, memo: "조금 이른 저녁" },
];

export function DatePlanner() {
  const [items, setItems] = useState(DATE_ITEMS);
  return <AppShell><div className="page-title-row"><div><span className="eyebrow">DATE PLANNER</span><h1>서촌 필름 산책</h1><p>9월 21일 월요일 · 15:00 — 21:30</p></div><button className="primary-button">＋ 새 데이트</button></div><div className="date-layout"><article className="date-feature"><img src="/assets/cafe-memory.png" alt="서촌 데이트의 카페" /><div className="image-shade" /><div><span>NEXT DATE · D−5</span><h2>사진 한 롤, 커피 두 잔</h2><p>조용한 골목을 따라 걷는 월요일</p><div className="date-tags"><b>조용하게</b><b>사진</b><b>도보 4km 이내</b></div></div></article><section className="date-plan paper-card"><div className="section-heading compact"><div><span className="eyebrow">SHARED PLANNING ENGINE</span><h2>9월 21일의 세 장면</h2></div><b className="budget-total">₩82,000</b></div><PlanTimeline items={items} onReorder={setItems} /><button className="add-schedule">＋ 장소 추가</button></section></div></AppShell>;
}

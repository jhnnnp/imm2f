"use client";

import { useState } from "react";
import type { PlanChange } from "@/features/planning/types/plan";

const changes: PlanChange[] = [
  { type: "remove", itemId: "item-lee", label: "이성당 삭제", detail: "오후에 여유 40분 확보" },
  { type: "duration", itemId: "item-eunpa", minutes: 160, label: "은파호수공원", detail: "120분 → 160분" },
];

export function AIPlanEditor({ onApply }: { onApply: (changes: PlanChange[]) => void }) {
  const [phase, setPhase] = useState<"idle" | "loading" | "preview">("idle");
  const [selected, setSelected] = useState([true, true]);
  const generate = () => { setPhase("loading"); window.setTimeout(() => setPhase("preview"), 900); };
  return <div className="ai-editor"><span className="eyebrow">PLAN WITH AI</span><h2>일정을 조금 더 여유롭게</h2><p className="panel-lead">자연스럽게 말해 주세요. 적용하기 전에 꼭 먼저 보여드릴게요.</p><textarea defaultValue="첫날 너무 빡센 것 같아. 카페 하나 빼고 좀 여유롭게 해줘." />
    <button className="primary-button full" onClick={generate}>변경안 만들기 ✦</button>
    {phase === "loading" && <div className="ai-progress"><span>여행을 정리하고 있어요.</span><p>✓ 선택 장소 확인</p><p>✓ 이동거리 비교</p><p>◌ 예산 조정</p></div>}
    {phase === "preview" && <div className="ai-proposal"><div className="proposal-title"><span>AI 변경 제안</span><b>2가지</b></div>{changes.map((change,index) => <label key={change.itemId}><input type="checkbox" checked={selected[index]} onChange={() => setSelected(current => current.map((value,i) => i === index ? !value : value))} /><span><em>{change.type === "remove" ? "삭제" : "변경"}</em><b>{change.label}</b><small>{change.detail}</small></span></label>)}<div className="proposal-summary"><span>예산 <b>₩168,000 → ₩150,000</b></span><span>도보 <b>5.8km → 4.9km</b></span></div><button className="primary-button full" onClick={() => onApply(changes.filter((_,index) => selected[index]))}>선택한 {selected.filter(Boolean).length}개 적용</button></div>}
  </div>;
}

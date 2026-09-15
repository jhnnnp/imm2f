import type { PlanItem } from "@/features/planning/types/plan";

export function PlanMap({ items }: { items: PlanItem[] }) {
  return <section className="planner-map" aria-label="1일차 여행 지도"><svg viewBox="0 0 620 620" aria-hidden="true"><path className="land" d="M0 96c110-52 167 30 259-3s140-72 236-8 87 42 125 24v511H0Z"/><path className="water" d="M-20 400c151-91 203 45 348-25s211-28 324 2"/><path className="route" d="M110 174C176 238 188 318 298 354s134 5 210 122"/></svg>{items.map((item,index) => <button className={`route-pin p${Math.min(index+1,4)}`} key={item.id}><span>{index+1}</span><b>{item.placeName}</b></button>)}<div className="map-summary"><span>DAY 1</span><b>{items.length}곳 · 7.2km</b><small>예상 이동 1시간 14분</small></div></section>;
}

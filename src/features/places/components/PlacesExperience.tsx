"use client";

import { useMemo, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { PLACE_CATEGORIES } from "../config/placeCategories";
import { PLACES as initialPlaces } from "../data/places";
import type { Place, PlacePreferenceStatus } from "../types/place";
import { PlaceCard } from "./PlaceCard";
import { PlaceDetailPanel } from "./PlaceDetailPanel";

type Filter = "all" | "want" | "visited" | "revisit";

export function PlacesExperience() {
  const [places, setPlaces] = useState<Place[]>(initialPlaces);
  const [selectedId, setSelectedId] = useState(initialPlaces[0].id);
  const [filter, setFilter] = useState<Filter>("all");
  const [category, setCategory] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const visible = useMemo(() => places.filter(place => {
    const statuses: PlacePreferenceStatus[] = [place.userStatus, place.partnerStatus];
    const matchesStatus = filter === "all" || (filter === "want" && statuses.some(value => value === "want" || value === "must_visit")) || statuses.includes(filter);
    return matchesStatus && (category === "all" || place.category === category) && place.name.toLowerCase().includes(query.toLowerCase());
  }), [places, filter, category, query]);
  const selected = places.find(place => place.id === selectedId) ?? places[0];
  const toggleSave = (id: string) => setPlaces(current => current.map(place => place.id === id ? { ...place, userStatus: place.userStatus === "want" ? "neutral" : "want" } : place));

  return <AppShell context={<PlaceDetailPanel place={selected} onAdd={() => setNotice(`${selected.name}을 군산 여행 후보에 추가했어요.`)} />}>
    <div className="page-title-row"><div><span className="eyebrow">OUR PLACE ARCHIVE</span><h1>둘의 장소</h1><p>다음에 가고 싶은 곳부터 다시 만나고 싶은 곳까지.</p></div><button className="primary-button" onClick={() => document.querySelector<HTMLInputElement>("#place-search")?.focus()}>＋ 장소 저장</button></div>
    <div className="toolbar"><div className="segmented" role="tablist" aria-label="장소 상태">{([['all','전체',42],['want','가고 싶어요',14],['visited','가봤어요',28],['revisit','다시 갈래요',9]] as const).map(([id,label,count]) => <button className={filter === id ? "is-active" : ""} onClick={() => setFilter(id)} key={id}>{label} <b>{count}</b></button>)}</div><div className="view-options"><button className="is-active" aria-label="그리드 보기">▦</button><button aria-label="목록 보기">☷</button><button aria-label="지도 보기">⌖</button></div></div>
    <div className="category-row"><button className={category === "all" ? "is-active" : ""} onClick={() => setCategory("all")}>전체</button>{PLACE_CATEGORIES.map(item => <button className={category === item.id ? "is-active" : ""} onClick={() => setCategory(item.id)} key={item.id}>{item.icon} {item.label}</button>)}<label><span>⌕</span><input id="place-search" value={query} onChange={event => setQuery(event.target.value)} placeholder="장소 이름 검색" /></label></div>
    {notice && <div className="inline-notice" role="status">{notice}<button onClick={() => setNotice("")}>×</button></div>}
    <div className="place-grid">{visible.map(place => <PlaceCard key={place.id} place={place} selected={selectedId === place.id} onSelect={() => setSelectedId(place.id)} onToggleSave={() => toggleSave(place.id)} />)}</div>
    {!visible.length && <div className="empty-inline"><h2>조건에 맞는 장소가 없어요.</h2><p>필터를 바꾸거나 다른 이름으로 검색해 보세요.</p></div>}
  </AppShell>;
}

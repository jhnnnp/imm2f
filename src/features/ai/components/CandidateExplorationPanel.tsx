"use client";

import { useState } from "react";
import { CAFE_CHOICES, CULTURE_CHOICES, CUISINE_CHOICES, EXPLORATION_ACTIVITIES,
  SHOPPING_CHOICES, type CandidateExplorationPreferences, type CandidateGroup,
  type ExplorationActivity, type ExplorationCard } from "../candidateExploration";

export function CandidateExplorationPanel({ area, nights, preferences, onPreferencesChange,
  groups, selectedIds, selectedCards, rejectedIds, busy, onSearch, onSelect, onReject, onMore,
  onRefine, onDetail, onPlan, onEdit }: {
  area: string; nights: number; preferences: CandidateExplorationPreferences;
  onPreferencesChange: (next: CandidateExplorationPreferences) => void;
  groups: CandidateGroup[] | null; selectedIds: string[]; selectedCards: ExplorationCard[]; rejectedIds: string[];
  busy: boolean; onSearch: () => void; onSelect: (card: ExplorationCard) => void;
  onReject: (card: ExplorationCard) => void; onMore: (id: ExplorationActivity) => void;
  onRefine: (id: ExplorationActivity, text: string) => void;
  onDetail: (card: ExplorationCard) => void; onPlan: () => void; onEdit: () => void;
}) {
  const [refinements, setRefinements] = useState<Partial<Record<ExplorationActivity, string>>>({});
  const chosen = selectedCards.filter(card => selectedIds.includes(card.candidateId));
  const toggle = (id: ExplorationActivity) => {
    const activities = preferences.activities.includes(id)
      ? preferences.activities.filter(item => item !== id) : [...preferences.activities, id];
    onPreferencesChange({ ...preferences, activities,
      provenance: { ...preferences.provenance, [id]: "user_selected" } });
  };
  return <section className="candidate-exploration" aria-label="장소 후보 탐색">
    {!groups ? <div className="candidate-intake">
      <div className="candidate-intake-heading">
        <span className="eyebrow">DISCOVER THE PLACE</span>
        <h3>어떤 경험을 담아볼까요?</h3>
        <p>알려주신 지역과 기간을 바탕으로 장소부터 함께 골라요.</p>
      </div>
      <div className="candidate-pref-summary"><b>{area} · {nights > 0 ? `${nights}박${nights + 1}일` : "하루"}</b>
        {preferences.activities.map(id => <span key={id}>{EXPLORATION_ACTIVITIES.find(item => item.id === id)?.label}</span>)}
        {preferences.cafeQualities.map(q => <span key={q}>{CAFE_CHOICES.find(item => item.value === q)?.label}</span>)}
        {preferences.cuisine && <span>{preferences.cuisine}</span>}
        <span>{preferences.pace === "relaxed" ? "여유롭게" : preferences.pace === "active" ? "많이 둘러보기" : "적당히"}</span>
      </div>
      <fieldset className="candidate-pref-field"><legend>이번 일정에서 하고 싶은 것</legend>
        <div className="candidate-choice-grid">{EXPLORATION_ACTIVITIES.map(option => <button key={option.id}
          type="button" aria-pressed={preferences.activities.includes(option.id)}
          className={preferences.activities.includes(option.id) ? "is-selected" : ""}
          onClick={() => toggle(option.id)}>{option.label}</button>)}</div>
      </fieldset>
      {preferences.activities.includes("cafe") && <fieldset className="candidate-pref-field"><legend>카페 조건 <small>선택 사항</small></legend>
        <div className="candidate-choice-grid">{CAFE_CHOICES.map(option => <button key={option.value}
          type="button" aria-pressed={preferences.cafeQualities.includes(option.value)}
          className={preferences.cafeQualities.includes(option.value) ? "is-selected" : ""}
          onClick={() => onPreferencesChange({ ...preferences, cafeQualities: preferences.cafeQualities.includes(option.value)
            ? preferences.cafeQualities.filter(q => q !== option.value) : [...preferences.cafeQualities, option.value],
            provenance: { ...preferences.provenance, [`cafe:${option.value}`]: "user_selected" } })}>{option.label}</button>)}</div>
      </fieldset>}
      {preferences.activities.includes("meal") && <fieldset className="candidate-pref-field"><legend>음식 종류 <small>선택 사항</small></legend>
        <div className="candidate-choice-grid">{CUISINE_CHOICES.map(option => <button key={option} type="button"
          aria-pressed={preferences.cuisine === option} className={preferences.cuisine === option ? "is-selected" : ""}
          onClick={() => onPreferencesChange({ ...preferences, cuisine: preferences.cuisine === option ? null : option,
            provenance: { ...preferences.provenance, cuisine: "user_selected" } })}>{option}</button>)}</div>
      </fieldset>}
      {preferences.activities.includes("shopping") && <fieldset className="candidate-pref-field"><legend>쇼핑 종류 <small>선택 사항</small></legend>
        <div className="candidate-choice-grid">{SHOPPING_CHOICES.map(option => <button key={option.value} type="button"
          aria-pressed={preferences.shoppingKind === option.value}
          className={preferences.shoppingKind === option.value ? "is-selected" : ""}
          onClick={() => onPreferencesChange({ ...preferences, shoppingKind: preferences.shoppingKind === option.value ? null : option.value,
            provenance: { ...preferences.provenance, shoppingKind: "user_selected" } })}>{option.label}</button>)}</div>
      </fieldset>}
      {preferences.activities.includes("culture") && <fieldset className="candidate-pref-field"><legend>문화 종류 <small>선택 사항</small></legend>
        <div className="candidate-choice-grid">{CULTURE_CHOICES.map(option => <button key={option.value} type="button"
          aria-pressed={preferences.cultureKind === option.value}
          className={preferences.cultureKind === option.value ? "is-selected" : ""}
          onClick={() => onPreferencesChange({ ...preferences, cultureKind: preferences.cultureKind === option.value ? null : option.value,
            provenance: { ...preferences.provenance, cultureKind: "user_selected" } })}>{option.label}</button>)}</div>
      </fieldset>}
      <fieldset className="candidate-pref-field"><legend>일정 스타일</legend>
        <div className="candidate-choice-grid is-pace">{([
          ["relaxed", "여유롭게"], ["balanced", "적당히"], ["active", "많이 둘러보기"],
        ] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={preferences.pace === value}
          className={preferences.pace === value ? "is-selected" : ""}
          onClick={() => onPreferencesChange({ ...preferences, pace: value,
            provenance: { ...preferences.provenance, pace: "user_selected" } })}>{label}</button>)}</div>
      </fieldset>
      <button className="candidate-primary" type="button" disabled={busy || !preferences.activities.length}
        onClick={onSearch}>{busy ? "장소를 찾고 있어요…" : "장소 후보 보기"}</button>
    </div> : <div className="candidate-results">
      <header className="candidate-results-head"><div><span className="eyebrow">YOUR PLACE SHORTLIST</span>
        <h3>{area} · {nights > 0 ? `${nights}박${nights + 1}일` : "하루"}</h3>
        <p>마음에 드는 곳만 골라 주세요. 모든 종류에서 고르지 않아도 됩니다.</p></div>
        <button type="button" onClick={onEdit}>조건 수정</button></header>
      {groups.map(group => <section className="candidate-group" key={group.id} aria-label={group.title}>
        <header className="candidate-group-head"><div><span className="eyebrow">CURATED PLACES</span>
          <h4>{group.title} <small>{group.cards.filter(card => !rejectedIds.includes(card.candidateId)).length}곳 추천</small></h4>
          <p>{group.description}</p></div>
          <button type="button" onClick={() => onMore(group.id)} disabled={busy}>다른 {group.id === "cafe" ? "카페" : "곳"} 보기</button>
        </header>
        <div className="candidate-card-grid">
          {group.cards.filter(card => !rejectedIds.includes(card.candidateId)).map((card, index) => {
            const selected = selectedIds.includes(card.candidateId);
            return <article key={card.candidateId} className={`candidate-card${selected ? " is-selected" : ""}`}>
              <div className="candidate-card-topline">
                <span className="candidate-card-index">{String(index + 1).padStart(2, "0")}</span>
                <span className="candidate-card-category">{card.category}</span>
                {selected && <span className="candidate-selected-mark">✓ 선택됨</span>}
              </div>
              <div className="candidate-card-main">
                <h5>{card.name}</h5>
                <p className="candidate-card-location">{card.address || card.area}</p>
              </div>
              <div className="candidate-card-evidence">
                <span className="candidate-card-evidence-label">{card.badges.length ? "확인된 특징" : "장소 특징"}</span>
                {card.badges.length ? <div className="candidate-card-badges">{card.badges.slice(0, 3)
                  .map(badge => <span key={badge}>{badge}</span>)}</div>
                  : <span className="candidate-card-unknown">세부 특징 확인 전</span>}
              </div>
              <div className="candidate-card-actions"><button type="button" className="candidate-select"
                aria-pressed={selected} onClick={() => onSelect(card)}>{selected ? "선택 취소" : "장소 선택"}</button>
                <button type="button" className="candidate-detail" onClick={() => onDetail(card)}>상세보기 <span aria-hidden="true">↗</span></button>
                <button type="button" className="candidate-reject" onClick={() => onReject(card)}>별로예요</button></div>
            </article>;
          })}
        </div>
        {!group.cards.some(card => !rejectedIds.includes(card.candidateId)) && <p className="candidate-empty">현재 조건으로 확인된 후보가 없어요. 조건을 바꾸거나 다른 곳을 볼 수 있어요.</p>}
        <form className="candidate-refine" onSubmit={event => { event.preventDefault(); const text = refinements[group.id]?.trim();
          if (text) { onRefine(group.id, text); setRefinements(current => ({ ...current, [group.id]: "" })); } }}>
          <input aria-label={`${group.title} 조건 다듬기`} value={refinements[group.id] ?? ""}
            placeholder="예: 좀 더 바다 보이는 곳" onChange={event => setRefinements(current => ({ ...current, [group.id]: event.target.value }))} />
          <button type="submit" disabled={busy || !refinements[group.id]?.trim()}>조건 다듬기</button>
        </form>
      </section>)}
      <footer className="candidate-selection-summary"><div><b>선택한 장소 {selectedIds.length}곳</b>
        <div>{chosen.map(card => <button type="button" key={card.candidateId} onClick={() => onSelect(card)}
          aria-label={`${card.name} 선택 취소`}>{card.name} ×</button>)}</div></div>
        <button type="button" className="candidate-primary" onClick={onPlan} disabled={busy || !selectedIds.length}>
          선택한 장소로 일정 짜기</button></footer>
    </div>}
  </section>;
}

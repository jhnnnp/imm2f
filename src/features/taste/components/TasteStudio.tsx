"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { initialFromName } from "@/features/auth/types";
import { withSubjectParticle } from "@/features/auth/koreanName";
import { calculatePreferenceInsight } from "@/lib/openai/analyzePreferences";
import type { Place } from "@/features/places/types/place";
import { saveTasteProfile } from "../actions";
import { emitCoupleActivitiesChanged } from "@/features/collaboration/activityClient";
import { emptyTasteInput, inputFromProfile } from "../parse";
import { profileFacets } from "../profileFacets";
import type { TasteBoard, TasteProfile } from "../types";
import { TasteForm } from "./TasteForm";

function PersonCard({
  name,
  mark,
  profile,
  empty,
  tone,
  waiting,
}: {
  name: string;
  mark: string;
  profile: TasteProfile | null;
  empty: string;
  tone: "you" | "partner";
  waiting?: boolean;
}) {
  const facets = profile ? profileFacets(profile) : [];
  const ready = Boolean(profile);
  return (
    <article className={`taste-person is-${tone}${waiting ? " is-waiting" : ""}${ready ? " is-ready" : ""}`}>
      <div className="taste-person-rule" aria-hidden="true" />
      <header className="taste-person-head">
        <span className="taste-person-mark" aria-hidden="true">{mark}</span>
        <div className="taste-person-meta">
          <small>{tone === "you" ? "MY BASELINE" : waiting ? "WAITING" : "PARTNER"}</small>
          <h3 className="taste-person-name">{name}</h3>
        </div>
        <span className={`taste-person-flag${ready ? " is-ready" : ""}`}>
          {ready ? "저장됨" : waiting ? "작성 전" : "비어 있음"}
        </span>
      </header>
      {profile ? (
        <div className="taste-person-body">
          {facets.map(facet => (
            <section className="taste-facet" key={facet.label}>
              <h4>{facet.label}</h4>
              <ul>
                {facet.items.map(item => (
                  <li key={item} className={facet.kind === "avoid" ? "is-avoid" : undefined}>{item}</li>
                ))}
              </ul>
            </section>
          ))}
          {profile.note ? <p className="taste-person-note">{profile.note}</p> : null}
        </div>
      ) : (
        <div className="taste-person-body is-empty">
          <div className="taste-person-skeleton" aria-hidden="true">
            <i /><i /><i />
          </div>
          <p className="taste-person-empty">{empty}</p>
        </div>
      )}
    </article>
  );
}

function TastePath({
  youReady,
  partnerReady,
  partnerConnected,
  partnerName,
}: {
  youReady: boolean;
  partnerReady: boolean;
  partnerConnected: boolean;
  partnerName: string;
}) {
  const steps = [
    { id: "you", label: "내 기준", detail: youReady ? "저장했어요" : "아직 비어 있어요" },
    {
      id: "partner",
      label: partnerConnected ? `${partnerName} 기준` : "파트너 연결",
      detail: partnerReady
        ? "저장됐어요"
        : partnerConnected
          ? "같은 화면에서 남기면 비교가 열려요"
          : "연결되면 두 기준이 만나요",
    },
    {
      id: "date",
      label: "데이트 뼈대",
      detail: youReady && partnerReady ? "겹치는 조건이 코스에 붙어요" : "둘 다 남기면 만들어져요",
    },
  ];
  return (
    <ol className="taste-path" aria-label="취향 기준 진행">
      {steps.map((step, index) => {
        const done = index === 0 ? youReady : index === 1 ? partnerReady : youReady && partnerReady;
        const current = !done && (index === 0 ? !youReady : index === 1 ? youReady : youReady && !partnerReady);
        return (
          <li key={step.id} className={done ? "is-done" : current ? "is-current" : ""}>
            <b>{String(index + 1).padStart(2, "0")}</b>
            <div>
              <strong>{step.label}</strong>
              <span>{step.detail}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function TasteStudio({ initial, places }: { initial: TasteBoard; places: Place[] }) {
  const [board, setBoard] = useState(initial);
  const [editing, setEditing] = useState(!initial.you);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const youInitial = initialFromName(board.youName);
  const partnerInitial = initialFromName(board.partnerName);
  const filledCount = Number(Boolean(board.you)) + Number(Boolean(board.partner));
  const placeInsight = useMemo(() => calculatePreferenceInsight(places.map(place => ({
    name: place.name,
    categoryLabel: place.categoryLabel,
    district: place.district,
    durationMinutes: place.durationMinutes,
    userStatus: place.userStatus,
    partnerStatus: place.partnerStatus,
    userRated: place.userRated,
    partnerRated: place.partnerRated,
  }))), [places]);
  const placeReady = placeInsight.evidence.sharedPositivePlaceCount > 0 || (
    placeInsight.evidence.youRatedCount >= 3 && placeInsight.evidence.partnerRatedCount >= 3
  );

  function save(input: Parameters<typeof saveTasteProfile>[0]) {
    setError("");
    startTransition(async () => {
      const result = await saveTasteProfile(input);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setBoard(result);
      setEditing(false);
      emitCoupleActivitiesChanged();
    });
  }

  return (
    <div className={`taste-studio${editing ? " is-composing" : ""}`}>
      {editing ? null : (
        <header className="taste-board-hero">
          <div className="taste-board-mast">
            <span className="taste-board-edition">OUR TASTE · SHEET 01</span>
            <h1>우리의 취향</h1>
            <p>
              {board.compare
                ? "둘의 취향과 식사 조건을 함께 살펴, 함께 즐길 데이트 코스를 추천해요."
                : "각자 데이트 기준을 남기면, 겹치는 동네와 빼야 할 음식이 바로 코스에 반영돼요."}
            </p>
          </div>
          <div className="taste-board-aside">
            <div
              className="taste-status"
              role="status"
              aria-label={`취향 기준 ${filledCount}명 중 2명`}
            >
              <div className="taste-status-track" aria-hidden="true">
                <i style={{ width: `${(filledCount / 2) * 100}%` }} />
              </div>
              <div className="taste-status-copy">
                <b>{filledCount} / 2</b>
                <small>
                  {board.compare
                    ? "비교가 열려 있어요"
                    : board.you
                      ? "상대 기준을 기다리는 중"
                      : "내 기준부터 남기면 시작돼요"}
                </small>
              </div>
            </div>
            {board.you ? (
              <button className="taste-action-button" type="button" onClick={() => setEditing(true)}>
                내 기준 수정
              </button>
            ) : null}
          </div>
        </header>
      )}

      {editing ? (
        <div className="taste-view" key="compose">
          <TasteForm
            initial={board.you ? inputFromProfile(board.you) : emptyTasteInput()}
            youName={board.youName}
            pending={pending}
            error={error}
            onCancel={board.you ? () => { setEditing(false); setError(""); } : undefined}
            onSave={save}
          />
        </div>
      ) : board.compare ? (
        <div className="taste-view taste-report" key="report">
          <section className="taste-overview">
            <article className="paper-card taste-brief-card">
              <span className="eyebrow">NEXT DATE</span>
              <h2>{board.compare.headline}</h2>
              <p>{board.compare.summary}</p>
              {board.compare.overlaps.length ? (
                <div className="taste-tags">
                  {board.compare.overlaps.map(item => <span key={item}><b>{item}</b></span>)}
                </div>
              ) : null}
              <Link className="primary-button taste-date-link" href="/date?from=taste">이 조건으로 데이트 만들기</Link>
            </article>
            <article className="paper-card common-taste-card">
              <span className="eyebrow">KEEP OUT</span>
              <h2>코스에서 빼는 것</h2>
              {board.compare.constraints.length ? (
                <div className="taste-tags">
                  {board.compare.constraints.map(item => <span key={item}><b>{item}</b></span>)}
                </div>
              ) : (
                <p>둘 다 빼 달라고 한 음식은 아직 없어요.</p>
              )}
            </article>
          </section>

          <section className="taste-section">
            <div className="taste-section-head">
              <span>01</span>
              <div>
                <small>BASELINES</small>
                <h2>말한 취향을 나란히 봐요</h2>
              </div>
            </div>
            <div className="taste-pair">
              <PersonCard name={board.youName} mark={youInitial} profile={board.you} empty="" tone="you" />
              <div className="taste-pair-join" aria-hidden="true"><span>&</span></div>
              <PersonCard name={board.partnerName} mark={partnerInitial} profile={board.partner} empty="" tone="partner" />
            </div>
          </section>

          {board.compare.differences.length ? (
            <section className="taste-section">
              <div className="taste-section-head">
                <span>02</span>
                <div>
                  <small>BRIDGE</small>
                  <h2>차이는 한 코스로 잇습니다</h2>
                </div>
              </div>
              <div className="difference-list">
                {board.compare.differences.map(item => (
                  <article className="paper-card difference-card" key={item.topic}>
                    <div><small>나</small><p>{item.you}</p></div>
                    <span aria-hidden="true" />
                    <div><small>{board.partnerName}</small><p>{item.partner}</p></div>
                    <aside><b>{item.topic}</b><p>{item.bridge}</p></aside>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          <section className="taste-section">
            <div className="taste-section-head">
              <span>03</span>
              <div>
                <small>RECORD</small>
                <h2>{placeReady ? "실제로 고른 곳과도 맞춰 봐요" : "장소 평가는 기준을 검증할 때 쓰여요"}</h2>
              </div>
            </div>
            <article className="paper-card taste-place-record">
              <dl className="taste-place-stats">
                <div>
                  <dt>내가 남긴 곳</dt>
                  <dd>{placeInsight.evidence.youRatedCount}</dd>
                </div>
                <div>
                  <dt>{board.partnerName}</dt>
                  <dd>{placeInsight.evidence.partnerRatedCount}</dd>
                </div>
                <div>
                  <dt>함께 긍정</dt>
                  <dd>{placeInsight.evidence.sharedPositivePlaceCount}</dd>
                </div>
              </dl>
              {placeReady && placeInsight.commonTastes.length ? (
                <div className="taste-tags">
                  {placeInsight.commonTastes.map(item => (
                    <span key={item.label}><b>{item.label}</b></span>
                  ))}
                </div>
              ) : (
                <p className="form-hint">같은 장소에 마음을 남기면, 말한 기준과 실제 기록이 같이 코스에 반영돼요.</p>
              )}
              <Link className="quiet-link" href="/places">장소 평가하러 가기</Link>
            </article>
          </section>
        </div>
      ) : (
        <section className="taste-view taste-waiting" key="wait">
          <div className="taste-pair">
            <PersonCard
              name={board.youName}
              mark={youInitial}
              profile={board.you}
              empty="내 기준을 저장하면 여기에 모여요."
              tone="you"
            />
            <div className="taste-pair-join" aria-hidden="true"><span>&</span></div>
            <PersonCard
              name={board.partnerConnected ? board.partnerName : "파트너"}
              mark={board.partnerConnected ? partnerInitial : "?"}
              profile={null}
              waiting
              empty={board.partnerConnected
                ? `${withSubjectParticle(board.partnerName)} 기준을 남기면 비교가 시작돼요.`
                : "파트너를 연결하면 두 기준이 만나요."}
              tone="partner"
            />
          </div>
          <article className="paper-card taste-wait-note">
            <div className="taste-wait-rule" aria-hidden="true" />
            <div className="taste-wait-copy">
              <span className="taste-wait-label">{board.partnerConnected ? "IN PROGRESS" : "NEED LINK"}</span>
              <h2>{board.partnerConnected ? "상대의 한 줄을 기다려요" : "먼저 연결이 필요해요"}</h2>
              <p>
                {board.partnerConnected
                  ? "내 기준은 저장됐어요. 상대가 같은 화면에서 기준을 남기는 순간, 다음 데이트 뼈대가 생깁니다."
                  : "혼자 남긴 기준은 내 코스 기본값으로 쓰이고, 연결되면 비교가 열려요."}
              </p>
              {board.partnerConnected ? null : (
                <Link className="primary-button taste-date-link" href="/invite">파트너 연결하기</Link>
              )}
            </div>
            <TastePath
              youReady={Boolean(board.you)}
              partnerReady={Boolean(board.partner)}
              partnerConnected={board.partnerConnected}
              partnerName={board.partnerName}
            />
          </article>
        </section>
      )}
    </div>
  );
}

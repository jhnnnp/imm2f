"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { AppLink } from "@/components/layout/AppLink";
import { ExpandableText } from "@/components/shared/ExpandableText";
import { SyncNotice } from "@/components/shared/SyncNotice";
import { useAppSession } from "@/features/auth/components/SessionProvider";
import { appSessionIdentity, initialFromName } from "@/features/auth/types";
import { withSubjectParticle } from "@/features/auth/koreanName";
import { calculatePreferenceInsight } from "@/lib/openai/preferenceInsight";
import type { Place } from "@/features/places/types/place";
import { useSharedRefresh } from "@/features/collaboration/useSharedRefresh";
import { readTasteWorkspace, saveTasteProfile } from "../actions";
import { emitCoupleActivitiesChanged } from "@/features/collaboration/activityClient";
import { emptyTasteInput, inputFromProfile } from "../parse";
import { profileFacets } from "../profileFacets";
import type { TasteBoard, TasteProfile } from "../types";
import { TasteForm } from "./TasteForm";
import styles from "./TasteStudio.module.css";

function Facets({ profile, full = false }: { profile: TasteProfile; full?: boolean }) {
  const facets = profileFacets(profile).filter(facet => full
    ? facet.label !== "자주 가는 동네" && facet.label !== "하고 싶은 것"
    : facet.label === "자주 가는 동네" || facet.label === "하고 싶은 것");
  return <>{facets.map(facet => (
    <section className="taste-facet" key={facet.label}>
      <h4>{facet.label}</h4>
      <ul>{facet.items.map(item => <li key={item} className={facet.kind === "avoid" ? "is-avoid" : undefined}>{item}</li>)}</ul>
    </section>
  ))}</>;
}

function PersonCard({ name, profile, tone, empty }: {
  name: string; profile: TasteProfile | null; tone: "you" | "partner"; empty: string;
}) {
  return (
    <article className={`taste-person ${styles.person} is-${tone}${profile ? " is-ready" : " is-waiting"}`}>
      <div className="taste-person-rule" aria-hidden="true" />
      <header className="taste-person-head">
        <span className="taste-person-mark" aria-hidden="true">{initialFromName(name)}</span>
        <div className="taste-person-meta"><small>{tone === "you" ? "MY TASTE" : "PARTNER"}</small><h3 className="taste-person-name">{name}</h3></div>
        <span className={`taste-person-flag${profile ? " is-ready" : ""}`}>{profile ? "저장됨" : "작성 전"}</span>
      </header>
      {profile ? <div className="taste-person-body">
        <Facets profile={profile} />
        <details className={styles.details}>
          <summary>하루·식사 조건 자세히</summary>
          <div className={styles.detailsBody}><Facets profile={profile} full />
            {profile.note ? <ExpandableText text={profile.note} lines={3} className="taste-person-note" label={`${name}의 한 줄`} /> : null}
          </div>
        </details>
      </div> : <p className="taste-person-empty">{empty}</p>}
    </article>
  );
}

export function TasteStudio({ initial, places: initialPlaces }: { initial: TasteBoard; places: Place[] }) {
  const session = useAppSession();
  const identity = appSessionIdentity(session);
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const [board, setBoard] = useState(initial);
  const [places, setPlaces] = useState(initialPlaces);
  const [editing, setEditing] = useState(!initial.you);
  const [editBase, setEditBase] = useState(initial.you);
  const [formVersion, setFormVersion] = useState(0);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const saving = useRef(false);
  const mutationEpoch = useRef(0);
  const mounted = useRef(true);
  const editButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; mutationEpoch.current += 1; }; }, []);

  const retrySync = useSharedRefresh(async ({ isCurrent }) => {
    const epoch = mutationEpoch.current;
    if (saving.current) return;
    try {
      const remote = await readTasteWorkspace();
      if (!isCurrent() || saving.current || epoch !== mutationEpoch.current) return;
      setBoard(remote.board);
      setPlaces(remote.places);
      setSyncError("");
    } catch {
      if (isCurrent() && epoch === mutationEpoch.current) setSyncError("최신 취향을 불러오지 못했어요. 다시 시도해 주세요.");
    }
  }, { tables: ["taste_profiles", "places", "place_preferences"], activityPrefixes: ["TASTE_", "PLACE_", "PARTNER_"] });
  const sessionYouName = session.mode === "authenticated" ? session.displayName : board.youName;
  const sessionPartnerName = session.mode === "authenticated" ? session.partner?.displayName ?? "파트너" : board.partnerName;
  const sessionPartnerId = session.mode === "authenticated" ? session.partner?.userId ?? "" : "";
  const sessionLabel = `${sessionYouName}:${sessionPartnerName}:${sessionPartnerId}`;
  const previousSessionLabel = useRef(sessionLabel);
  useEffect(() => {
    if (previousSessionLabel.current === sessionLabel) return;
    previousSessionLabel.current = sessionLabel;
    retrySync();
  }, [sessionLabel, retrySync]);

  const filledCount = Number(Boolean(board.you)) + Number(Boolean(board.partner));
  const placeInsight = useMemo(() => calculatePreferenceInsight(places.map(place => ({
    name: place.name, categoryLabel: place.categoryLabel, district: place.district,
    durationMinutes: place.durationMinutes, userStatus: place.userStatus,
    partnerStatus: place.partnerStatus, userRated: place.userRated, partnerRated: place.partnerRated,
  }))), [places]);
  const placeReady = placeInsight.evidence.sharedPositivePlaceCount > 0 || (
    placeInsight.evidence.youRatedCount >= 3 && placeInsight.evidence.partnerRatedCount >= 3
  );
  const originalChanged = editing && JSON.stringify(board.you) !== JSON.stringify(editBase);

  function openEditor() {
    if (saving.current) return;
    setEditBase(board.you); setFormVersion(version => version + 1);
    setError(""); setConflict(false); setSavedMessage(""); setEditing(true);
  }

  function closeEditor() {
    if (saving.current) return;
    setEditing(false); setError(""); setConflict(false);
    requestAnimationFrame(() => editButton.current?.focus({ preventScroll: true }));
  }

  function reloadEditor() {
    if (saving.current) return;
    saving.current = true;
    const epoch = ++mutationEpoch.current;
    const startedIdentity = identity;
    startTransition(async () => {
      try {
        const remote = await readTasteWorkspace();
        if (!mounted.current || currentIdentity.current !== startedIdentity || epoch !== mutationEpoch.current) return;
        setBoard(remote.board); setPlaces(remote.places); setEditBase(remote.board.you);
        setFormVersion(version => version + 1); setError(""); setConflict(false); setSyncError("");
      } catch {
        if (mounted.current && currentIdentity.current === startedIdentity) setError("최신 기준을 불러오지 못했어요. 입력 내용은 유지됩니다.");
      } finally { saving.current = false; mutationEpoch.current += 1; }
    });
  }

  function save(input: Parameters<typeof saveTasteProfile>[0]) {
    if (saving.current || conflict) return;
    saving.current = true;
    const epoch = ++mutationEpoch.current;
    const startedIdentity = identity;
    const expectedScope = session.mode === "authenticated" ? { userId: session.userId, coupleId: session.coupleId } : undefined;
    setError("");
    startTransition(async () => {
      try {
        const result = await saveTasteProfile(input, { expectedSnapshot: JSON.stringify(editBase), expectedScope });
        if (!mounted.current || currentIdentity.current !== startedIdentity || epoch !== mutationEpoch.current) return;
        if ("error" in result) {
          setError(result.error); setConflict("conflict" in result && Boolean(result.conflict)); return;
        }
        setBoard(result); setEditBase(result.you); setEditing(false); setConflict(false);
        setSavedMessage("내 취향을 저장했어요."); setSyncError("");
        emitCoupleActivitiesChanged();
        requestAnimationFrame(() => editButton.current?.focus({ preventScroll: true }));
      } catch {
        if (mounted.current && currentIdentity.current === startedIdentity) setError("취향을 저장하지 못했어요. 입력은 그대로 남아 있으니 다시 시도해 주세요.");
      } finally {
        saving.current = false; mutationEpoch.current += 1;
        if (mounted.current && currentIdentity.current === startedIdentity) retrySync();
      }
    });
  }

  return (
    <div className={`${styles.studio} taste-studio${editing ? " is-composing" : ""}`}>
      <SyncNotice message={syncError} onRetry={retrySync} />
      <header className={`taste-board-hero ${styles.hero}`}>
        <div className="taste-board-mast"><span className="taste-board-edition">OUR TASTE</span><h1>우리의 취향</h1>
          <p>{editing ? "내가 좋아하는 하루를 남겨 주세요." : "둘의 취향을 모아, 다음 데이트의 출발점을 찾아요."}</p>
        </div>
        {!editing ? <div className="taste-board-aside">
          <div className={styles.status} role="status"><span className={styles.statusDot} aria-hidden="true" />
            {board.compare ? "두 사람의 취향이 준비됐어요" : board.partnerConnected ? `${filledCount}/2명 작성` : "파트너 연결 전"}
          </div>
          <button ref={editButton} className="taste-action-button" type="button" onClick={openEditor}>{board.you ? "내 취향 수정" : "내 취향 남기기"}</button>
        </div> : <button className="outline-button" type="button" disabled={pending} onClick={closeEditor}>취향 화면으로</button>}
      </header>
      {savedMessage && !editing ? <p className={styles.saved} role="status">✓ {savedMessage}</p> : null}
      {editing ? (
        <div className="taste-view" key="compose">
          {originalChanged && !conflict ? <p className={styles.inputNotice} role="status">다른 기기에서 내 취향이 바뀌었어요. 지금 입력한 내용은 유지됩니다.</p> : null}
          <TasteForm key={formVersion} initial={editBase ? inputFromProfile(editBase) : emptyTasteInput()}
            youName={board.youName} pending={pending} error={error} conflict={conflict}
            onConflictReload={reloadEditor} onCancel={closeEditor} onSave={save}
            onChange={() => { if (!conflict) setError(""); }} />
        </div>
      ) : (
        <div className="taste-view taste-report">
          {board.compare ? <section className={`taste-overview ${styles.overview}`} aria-label="함께 고른 데이트 조건">
            <article className={`paper-card taste-brief-card ${styles.brief}`}>
              <span className="eyebrow">NEXT DATE</span><h2>{board.compare.headline}</h2>
              <ExpandableText text={board.compare.summary} lines={3} className={styles.summary} label="데이트 제안" />
              {board.compare.overlaps.length ? <div className="taste-tags" aria-label="공통 취향">{board.compare.overlaps.map(item => <span key={item}><b>{item}</b></span>)}</div> : null}
              <AppLink className="primary-button taste-date-link" href="/date?from=taste">이 취향으로 AI 추천받기 <span aria-hidden="true">↗</span></AppLink>
              <p className={styles.actionHint}>조건을 확인하고 장소를 고른 뒤 코스로 저장해요.</p>
            </article>
            <article className={`paper-card common-taste-card ${styles.constraints}`}>
              <span className="eyebrow">KEEP OUT</span><h2>함께 피할 것</h2>
              {board.compare.constraints.length ? <div className="taste-tags">{board.compare.constraints.map(item => <span key={item}><b>{item}</b></span>)}</div> : <p>등록한 제외 조건이 없어요.</p>}
              <p className={styles.actionHint}>한 사람이라도 제외한 조건을 함께 반영해요.</p>
            </article>
          </section> : <section className={`paper-card ${styles.waiting}`}>
            <span className="eyebrow">NEXT DATE</span>
            <h2>{board.partner ? "내 취향을 남기면 두 사람의 비교가 완성돼요" : board.partnerConnected ? `${withSubjectParticle(board.partnerName)} 취향을 남기면 함께 비교해요` : "두 사람의 취향을 한곳에"}</h2>
            <p>{board.you ? "내 취향은 저장됐어요. 지금도 내 조건으로 데이트를 추천받을 수 있어요." : "내 취향을 남기면 좋아하는 동네와 활동이 추천에 반영돼요."}</p>
            <div className={styles.waitActions}>
              {board.you ? <AppLink className="primary-button" href="/date?from=taste">내 취향으로 AI 추천받기</AppLink> : <button type="button" className="primary-button" onClick={openEditor}>내 취향 남기기</button>}
              {!board.partnerConnected ? <AppLink className="outline-button" href="/invite">파트너 연결하기</AppLink> : null}
            </div>
          </section>}

          <section className="taste-section">
            <div className="taste-section-head"><div><small>OUR BASELINES</small><h2>각자의 취향</h2></div></div>
            <div className="taste-pair">
              <PersonCard name={board.youName} profile={board.you} tone="you" empty="좋아하는 동네와 하루를 남겨 주세요." />
              <div className="taste-pair-join" aria-hidden="true"><span>&</span></div>
              <PersonCard name={board.partnerConnected ? board.partnerName : "파트너"} profile={board.partner} tone="partner"
                empty={board.partnerConnected ? "파트너가 내 취향을 저장하면 여기에 보여요." : "파트너를 연결하면 서로의 취향을 볼 수 있어요."} />
            </div>
          </section>

          {board.compare?.differences.length ? <details className={`${styles.details} ${styles.differences}`}>
            <summary><span>서로 다른 취향을 맞추는 방법</span><small>{board.compare.differences.length}가지</small></summary>
            <div className="difference-list">{board.compare.differences.map(item => (
              <article className="paper-card difference-card" key={item.topic}>
                <div><small>나</small><p>{item.you}</p></div><span aria-hidden="true">↔</span>
                <div><small>{board.partnerName}</small><p>{item.partner}</p></div><aside><b>{item.topic}</b><p>{item.bridge}</p></aside>
              </article>
            ))}</div>
          </details> : null}

          <section className={`paper-card taste-place-record ${styles.record}`}>
            <div><span className="eyebrow">OUR CHOICES</span><h2>장소에 남긴 마음</h2>
              <p>{placeReady ? "저장한 장소에 남긴 두 사람의 평가예요." : "장소에 마음을 남길수록 함께 좋아하는 곳을 더 잘 알 수 있어요."}</p>
              <AppLink className="quiet-link" href="/places">장소 둘러보기 →</AppLink>
            </div>
            <dl className="taste-place-stats">
              <div><dt>내 평가</dt><dd>{placeInsight.evidence.youRatedCount}<small>곳</small></dd></div>
              <div><dt>{board.partnerName} 평가</dt><dd>{placeInsight.evidence.partnerRatedCount}<small>곳</small></dd></div>
              <div><dt>함께 좋아요</dt><dd>{placeInsight.evidence.sharedPositivePlaceCount}<small>곳</small></dd></div>
            </dl>
            {placeReady && placeInsight.commonTastes.length ? <div className="taste-tags">{placeInsight.commonTastes.map(item => <span key={item.label}><b>{item.label}</b></span>)}</div> : null}
          </section>
        </div>
      )}
    </div>
  );
}

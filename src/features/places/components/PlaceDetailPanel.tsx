"use client";

import { useAppSession } from "@/features/auth/components/SessionProvider";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { ExpandableText } from "@/components/shared/ExpandableText";
import type { TripScheduleStop } from "../tripPlaceMatch";
import type { Place, PlacePreferenceStatus } from "../types/place";
import { isDiscoverPlace } from "../discover";
import { STATUS_META } from "../config/statusMeta";
import { PlaceStatusBadge } from "./PlaceStatusBadge";
import { PlaceTripStamp } from "./PlaceTripStampIcon";
import { kakaoPlaceUrl, naverPlaceSearchUrl } from "../format";
import { openPlaceMiniWindow } from "../openPlaceMini";
import { PlaceGraphicCover } from "./PlaceGraphicCover";
import { PlaceLocationMap } from "./PlaceLocationMap";
import styles from "./PlaceDetailPanel.module.css";

const STATUS_OPTIONS: PlacePreferenceStatus[] = ["want", "visited", "revisit", "not_interested"];
const HEART_SAVED: PlacePreferenceStatus[] = ["want", "must_visit", "revisit"];

function ReadablePlaceText({ text, label = "설명" }: { text: string; label?: string }) {
  return <ExpandableText text={text} className={styles.readableText} moreLabel={`전체 ${label} 보기`} lessLabel={`${label} 접기`} />;
}

function optionIsActive(current: PlacePreferenceStatus, option: PlacePreferenceStatus) {
  if (option === "want") return current === "want" || current === "must_visit";
  if (option === "not_interested") return current === "not_interested" || current === "dislike";
  return current === option;
}

export function PlaceDetailPanel({
  place,
  onAdd,
  onAddDate,
  onStatusChange,
  onSave,
  onLocationSave,
  onDescriptionSave,
  preferredPlan,
  tripDestinationLabel,
  tripScheduleStops = [],
  planPending = null,
  savePending = false,
}: {
  place: Place;
  onAdd: () => void;
  onAddDate?: () => void;
  onStatusChange?: (status: PlacePreferenceStatus) => void;
  onSave?: () => void;
  onLocationSave?: (input: { address: string; district: string }) => Promise<{ error?: string } | void>;
  onDescriptionSave?: (description: string) => Promise<{ error?: string } | void>;
  preferredPlan?: "trip" | "date" | null;
  tripDestinationLabel?: string;
  tripScheduleStops?: TripScheduleStop[];
  planPending?: "trip" | "date" | null;
  savePending?: boolean;
}) {
  const session = useAppSession();
  const memoAuthor = session.mode === "authenticated" && place.memoAuthorId ? (place.memoAuthorId === session.userId ? session.displayName : place.memoAuthorId === session.partner?.userId ? session.partner.displayName : "이전 작성자") : null;
  const preview = isDiscoverPlace(place);
  const saved = HEART_SAVED.includes(place.userStatus);
  const address = place.roadAddress || place.address || place.district;
  const kakaoUrl = place.externalSource === "kakao" && place.mapUrl
    ? place.mapUrl
    : kakaoPlaceUrl(place.name, place.coordinates);
  const [editing, setEditing] = useState(false);
  const [memoEditing, setMemoEditing] = useState(false);
  const [memoDraft, setMemoDraft] = useState(place.description);
  const [addressDraft, setAddressDraft] = useState(place.roadAddress || place.address || "");
  const [districtDraft, setDistrictDraft] = useState(place.district);
  const [pending, setPending] = useState(false);
  const [memoPending, setMemoPending] = useState(false);
  const [error, setError] = useState("");
  const [memoError, setMemoError] = useState("");
  const locationSaving = useRef(false);
  const memoSaving = useRef(false);
  const statusLabelId = useId();
  const partnerName = session.mode === "authenticated" ? session.partner?.displayName || "파트너" : "파트너";

  useEffect(() => {
    setEditing(false);
    setMemoEditing(false);
    setMemoDraft(place.description);
    setPending(false);
    setMemoPending(false);
    setError("");
    setMemoError("");
  }, [place.id, place.description]);

  useEffect(() => {
    setAddressDraft(place.roadAddress || place.address || "");
    setDistrictDraft(place.district);
  }, [place.id, place.roadAddress, place.address, place.district]);

  async function saveLocation(formData: FormData) {
    if (!onLocationSave || locationSaving.current) return;
    locationSaving.current = true;
    setPending(true);
    setError("");
    try {
      const result = await onLocationSave({
        address: String(formData.get("address") ?? ""),
        district: String(formData.get("district") ?? ""),
      });
      if (result && "error" in result && result.error) { setError(result.error); return; }
      setEditing(false);
    } catch {
      setError("위치를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      locationSaving.current = false;
      setPending(false);
    }
  }

  async function saveMemo(event: React.FormEvent) {
    event.preventDefault();
    if (!onDescriptionSave || memoSaving.current) return;
    memoSaving.current = true;
    setMemoPending(true);
    setMemoError("");
    try {
      const result = await onDescriptionSave(memoDraft);
      if (result && "error" in result && result.error) { setMemoError(result.error); return; }
      setMemoEditing(false);
    } catch {
      setMemoError("메모를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      memoSaving.current = false;
      setMemoPending(false);
    }
  }

  const memoText = place.description.trim();
  const recommendation = place.recommendReason?.trim() ?? "";
  const overview = place.sourceDescription?.trim() || (preview && memoText !== recommendation ? memoText : "");
  const canEditMemo = !preview && Boolean(onDescriptionSave);

  return <div className={`place-detail-panel ${styles.panel}`} data-place-id={place.id}>
    <div className={`detail-photo tone-${place.visualTone} ${place.image ? "" : "is-empty"}`}>{place.image ? <img src={place.image} alt={place.name} /> : <PlaceGraphicCover place={place} />}<span>{place.categoryLabel.toUpperCase()} · {preview ? "CANDIDATE" : "PLACE"}</span></div>
    <div className={`place-detail-head ${styles.head}`}><div><span className={styles.eyebrow}>{preview ? "발견한 장소" : "우리의 장소"}</span><h2 className="place-detail-title">{place.name}{!preview && tripScheduleStops.length > 0 ? <PlaceTripStamp compact /> : null}</h2>
      {!editing && (
        <p>
          {address}
          {onLocationSave && <button className="place-edit-link" type="button" onClick={() => {
            setAddressDraft(place.roadAddress || place.address || "");
            setDistrictDraft(place.district);
            setEditing(true);
          }}>수정</button>}
        </p>
      )}
    </div>{!preview && onSave && <button className={`detail-heart ${styles.heart} ${saved ? "is-on" : ""} ${savePending ? "is-loading" : ""}`} type="button" aria-pressed={saved} aria-busy={savePending} disabled={savePending} aria-label={savePending ? "장소 상태 저장 중" : saved ? "가고 싶어요 해제" : "가고 싶어요"} onClick={() => onSave()}>{savePending ? <i className="button-spinner" aria-hidden="true" /> : saved ? "♥" : "♡"}</button>}</div>
    {editing && (
      <form className="place-location-edit" action={formData => void saveLocation(formData)} aria-busy={pending}>
        <label className="field">
          <span>주소</span>
          <input name="address" required disabled={pending} value={addressDraft} onChange={event => setAddressDraft(event.target.value)} placeholder="전북 군산시 경촌4길 14" />
        </label>
        <label className="field">
          <span>동네</span>
          <input name="district" disabled={pending} value={districtDraft} onChange={event => setDistrictDraft(event.target.value)} placeholder="군산시 경암동" />
        </label>
        <p className="form-hint">수정한 주소로 지도 위치를 다시 확인해요.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="dialog-actions">
          <button className="outline-button" type="button" disabled={pending} onClick={() => { setEditing(false); setError(""); }}>취소</button>
          <button className={`primary-button${pending ? " is-loading" : ""}`} type="submit" disabled={pending} aria-busy={pending}>{pending && <i className="button-spinner" aria-hidden="true" />}{pending ? "위치 확인 중..." : "위치 저장"}</button>
        </div>
      </form>
    )}
    {recommendation && <section className={styles.recommendation} aria-label="추천 포인트">
      <span className={styles.sectionLabel}>추천 포인트</span>
      <ReadablePlaceText key={`${place.id}:recommendation`} text={recommendation} />
    </section>}
    {overview && <section className={styles.overview} aria-label="장소 소개">
      <div className={styles.overviewHead}><h3>장소 소개</h3>{place.externalSource === "tourapi" && <span>한국관광공사 · 대한민국 구석구석</span>}</div>
      <ReadablePlaceText key={`${place.id}:overview`} text={overview} />
    </section>}
    {!preview && <section className="place-memo-block" aria-labelledby="place-memo-label">
      <div className="place-memo-head">
        <span id="place-memo-label" className="place-memo-label">우리 메모</span>
        {canEditMemo && !memoEditing ? (
          <button className="place-edit-link" type="button" onClick={() => { setMemoDraft(place.description); setMemoEditing(true); setMemoError(""); }}>
            {memoText ? "수정" : "작성"}
          </button>
        ) : null}
      </div>
      {memoEditing ? (
        <form className="place-memo-edit" onSubmit={event => void saveMemo(event)} aria-busy={memoPending}>
          <textarea
            value={memoDraft}
            onChange={event => setMemoDraft(event.target.value)}
            rows={4}
            placeholder="이 장소에서 하고 싶은 것, 기억하고 싶은 것"
            aria-label="우리 메모"
            disabled={memoPending}
            autoFocus
          />
          {memoError ? <p className="form-error" role="alert">{memoError}</p> : null}
          <div className="dialog-actions">
            <button className="outline-button" type="button" onClick={() => { setMemoEditing(false); setMemoDraft(place.description); setMemoError(""); }} disabled={memoPending}>취소</button>
            <button className={`primary-button${memoPending ? " is-loading" : ""}`} type="submit" disabled={memoPending} aria-busy={memoPending}>{memoPending && <i className="button-spinner" aria-hidden="true" />}{memoPending ? "메모 저장 중..." : "메모 저장"}</button>
          </div>
        </form>
      ) : memoText ? (
        <><ReadablePlaceText key={`${place.id}:memo`} text={memoText} label="메모" /><small className={styles.memoAuthor}>{memoAuthor ? `${memoAuthor} · 마지막으로 작성` : "저장한 메모"}</small></>
      ) : (
        <p className={styles.emptyMemo}>함께 남긴 메모가 없어요.</p>
      )}
    </section>}
    {!preview && tripScheduleStops.length > 0 && (
      <section className="place-trip-block" aria-labelledby="place-trip-label">
        <div className="place-memo-head">
          <span id="place-trip-label" className="place-memo-label">여행 일정</span>
          <Link className="place-edit-link" href="/trip">여행 탭</Link>
        </div>
        <ul className="place-trip-stops">
          {tripScheduleStops.map(stop => (
            <li key={stop.key}>
              <div className="place-trip-stop-head">
                <span className="place-trip-day">
                  {stop.scope === "archive" ? "지난 여행" : tripDestinationLabel ? "조회 중인 여행" : "진행 중"} · {stop.item.dayIndex + 1}일차
                </span>
                {stop.scope === "archive"
                  ? <Link className="place-edit-link" href="/memories">기록 보기</Link>
                  : null}
              </div>
              <p className="place-trip-plan-title">{stop.planTitle}{stop.startDate ? ` · ${stop.startDate}` : ""}</p>
              {stop.item.memo.trim() ? <p>{stop.item.memo.trim()}</p> : <p className="muted">일정 메모 없음</p>}
            </li>
          ))}
        </ul>
      </section>
    )}
    {place.coordinates && <PlaceLocationMap name={place.name} coordinates={place.coordinates} />}
    {preview && (place.detailedCategory || place.openingHours || place.detailFacts?.length) && <dl className="place-api-facts">
      {place.detailedCategory && <div><dt>분류</dt><dd>{place.detailedCategory.split(">").map(item => item.trim()).filter(Boolean).slice(-2).join(" · ")}</dd></div>}
      {place.openingHours && <div><dt>{place.category === "festival" && !place.detailFacts?.some(fact => fact.label === "기간") ? "기간" : "이용시간"}</dt><dd>{place.openingHours}</dd></div>}
      {place.detailFacts?.map(fact => <div key={`${fact.label}-${fact.value}`}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
    </dl>}
    <div className={`external-place-links ${styles.mapLinks}`}>
      <span className={styles.sectionLabel}>지도에서 확인</span>
      <div className={styles.mapGrid}>
        <button type="button" className={styles.mapLink} onClick={() => openPlaceMiniWindow(kakaoUrl, "kakao")} aria-label="카카오맵에서 보기">
          <span className={`${styles.mapMark} ${styles.kakaoMark}`} aria-hidden="true">K</span>
          <span className={styles.mapService}><b>카카오맵</b><small>장소와 위치 보기</small></span><span className={styles.linkArrow} aria-hidden="true">↗</span>
        </button>
        <button type="button" className={styles.mapLink} onClick={() => openPlaceMiniWindow(naverPlaceSearchUrl(place.name, address), "naver")} aria-label="네이버 지도에서 보기">
          <span className={`${styles.mapMark} ${styles.naverMark}`} aria-hidden="true">N</span>
          <span className={styles.mapService}><b>네이버 지도</b><small>장소와 위치 보기</small></span><span className={styles.linkArrow} aria-hidden="true">↗</span>
        </button>
      </div>
      {place.externalSource === "tourapi" && place.mapUrl && <a className="place-source-link" href={place.mapUrl} target="_blank" rel="noreferrer">대한민국 구석구석 상세정보 <span>↗</span></a>}
      {place.homepage && <a className="place-source-link" href={place.homepage} target="_blank" rel="noreferrer">공식 홈페이지 <span>↗</span></a>}
    </div>
    {preview ? (
      <button className={`${preferredPlan ? "outline-button" : "primary-button"} ${styles.previewSave}`} type="button" onClick={onSave} disabled={savePending || !onSave} aria-busy={savePending}>{savePending ? "장소 저장 중…" : "장소 저장하기"}</button>
    ) : (
      <section className={styles.statusSection} aria-labelledby={statusLabelId}>
        <div className={styles.statusHeading}><h3 id={statusLabelId}>내 마음</h3><span>{savePending ? "저장 중…" : place.userStatus === "neutral" ? "아직 선택하지 않았어요" : "선택한 마음"}</span></div>
        {onStatusChange ? <div className={styles.statusPicker} role="group" aria-label="이 장소에 대한 내 마음" aria-busy={savePending}>{STATUS_OPTIONS.map(status => {
          const active = optionIsActive(place.userStatus, status);
          return <button type="button" className={`${styles.statusOption} ${active ? styles.statusActive : ""}`} key={status}
            aria-pressed={active} aria-busy={savePending} disabled={savePending}
            onClick={() => { if (!savePending) onStatusChange(active ? "neutral" : status); }}>
            <span className={styles.statusIcon} aria-hidden="true">{STATUS_META[status].icon}</span>
            <span>{STATUS_META[status].label}</span>
            <span className={styles.statusCheck} aria-hidden="true">{active ? "✓" : ""}</span>
          </button>;
        })}</div> : <div className={styles.readOnlyStatus}><PlaceStatusBadge status={place.userStatus} /></div>}
        <p className={styles.statusHint} role="status" aria-live="polite">{savePending ? "마음을 저장하고 있어요." : onStatusChange ? "선택한 마음을 한 번 더 누르면 해제돼요." : "저장한 내 마음이에요."}</p>
        <div className={styles.partnerStatus}>
          <span className={styles.partnerAvatar} aria-hidden="true">{partnerName.slice(0, 1)}</span>
          <span className={styles.partnerLabel}>{partnerName}<small>파트너의 마음</small></span>
          <span className={styles.partnerBadge}><span aria-hidden="true">{STATUS_META[place.partnerStatus].icon}</span>{STATUS_META[place.partnerStatus].label}</span>
        </div>
      </section>
    )}
    <div className={styles.planActions}>
    {preferredPlan === "date" && onAddDate && <button className={`primary-button full${planPending === "date" ? " is-loading" : ""}`} type="button" onClick={onAddDate} disabled={Boolean(planPending)} aria-busy={planPending === "date"}>{planPending === "date" && <i className="button-spinner" aria-hidden="true" />}{planPending === "date" ? "데이트에 담는 중..." : "이 데이트에 추가"}</button>}
    {preferredPlan === "trip" && <><p className="place-plan-destination">{tripDestinationLabel ?? "선택한 여행 일정"}</p><button className={`primary-button full${planPending === "trip" ? " is-loading" : ""}`} type="button" onClick={onAdd} disabled={Boolean(planPending)} aria-busy={planPending === "trip"}>{planPending === "trip" && <i className="button-spinner" aria-hidden="true" />}{planPending === "trip" ? "선택한 날에 담는 중..." : "선택한 날에 추가"}</button></>}
    {preferredPlan !== "trip" && <button className={`outline-button full${planPending === "trip" ? " is-loading" : ""}`} type="button" onClick={onAdd} disabled={Boolean(planPending)} aria-busy={planPending === "trip"}>{planPending === "trip" && <i className="button-spinner" aria-hidden="true" />}{planPending === "trip" ? "여행에 담는 중..." : "여행 일정에 추가"}</button>}
    {preferredPlan !== "date" && onAddDate && <button className={`outline-button full${planPending === "date" ? " is-loading" : ""}`} type="button" onClick={onAddDate} disabled={Boolean(planPending)} aria-busy={planPending === "date"}>{planPending === "date" && <i className="button-spinner" aria-hidden="true" />}{planPending === "date" ? "데이트에 담는 중..." : "데이트 일정에 추가"}</button>}
    </div>
  </div>;
}

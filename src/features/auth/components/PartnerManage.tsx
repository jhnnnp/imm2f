"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useDialogFocus } from "@/components/shared/useDialogFocus";
import { initialFromName } from "../types";
import { pairLabel, withAndParticle } from "../koreanName";
import { leaveCouple } from "../session";
import styles from "./PartnerSpace.module.css";

export function PartnerManage({
  youName,
  partnerName,
  connectedOn,
}: {
  youName: string;
  partnerName: string;
  connectedOn: string | null;
}) {
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const leaving = useRef(false);
  const close = () => { if (!leaving.current) { setConfirm(false); setError(""); } };
  const dialogRef = useDialogFocus<HTMLDivElement>({ open: confirm, onClose: close, initialFocus: "[data-dialog-cancel]" });
  const youInitial = initialFromName(youName);
  const partnerInitial = initialFromName(partnerName);

  async function leave() {
    if (!confirm || leaving.current) return;
    leaving.current = true;
    setPending(true);
    setError("");
    try {
      const result = await leaveCouple();
      if (result?.error) setError(result.error);
    } catch { setError("연결을 해제하지 못했어요. 다시 시도해 주세요."); }
    finally { leaving.current = false; setPending(false); }
  }

  return (
    <>
    <section className={`partner-manage ${styles.space}`}>
      <article className="partner-manage-card">
        <span className="eyebrow">CONNECTED SPACE</span>
        <div className="partner-manage-avatars" aria-hidden="true">
          <span className="avatar you">{youInitial}</span>
          <span className="avatar partner">{partnerInitial}</span>
        </div>
        <h2>{pairLabel(youName, partnerName)}</h2>
        <p className="partner-manage-status"><i />연결되어 있어요</p>
        <p>{withAndParticle(youName)} {partnerName}의 공간입니다. 장소, 일정, 추억이 같은 화면에 쌓여요.</p>
        {connectedOn ? <p className="partner-manage-since">{connectedOn}부터 함께하고 있어요.</p> : null}
        <ul className="partner-manage-facts">
          <li>사이드바와 홈에 서로의 이름이 보여요.</li>
          <li>한 사람이 저장한 장소는 상대 홈의 파트너 칸에도 모여요.</li>
          <li>데이트 기준은 취향 화면에서 각자 남기면 코스에 바로 반영돼요.</li>
        </ul>
      </article>
      <div className="partner-manage-side">
        <aside className="partner-manage-taste">
          <span className="eyebrow">OUR TASTE</span>
          <h3>다음 데이트의 기준</h3>
          <p>좋아하는 동네와 걷는 속도, 피하고 싶은 음식을 함께 알려 주세요. 둘 다 편안한 데이트를 추천해 드릴게요.</p>
          <Link className="primary-button" href="/insights">우리 기준 열기</Link>
        </aside>
        <aside className="partner-manage-leave">
          <span className="eyebrow">SPACE RESET</span>
          <h3>연결을 해제할까요?</h3>
          <p>내가 나가면 장소·일정·추억은 {partnerName}의 공간에 남아요. 나는 빈 공간으로 다시 시작해요.</p>
          <button
            className="outline-button"
            type="button"
            onClick={() => { setError(""); setConfirm(true); }}
            disabled={pending}
            aria-label="파트너 연결 해제"
          >
            연결 해제
          </button>
        </aside>
      </div>
    </section>
      {confirm && <div className="dialog-backdrop" onClick={close}>
        <div ref={dialogRef} tabIndex={-1} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="partner-leave-title" onClick={event => event.stopPropagation()}>
          <h2 id="partner-leave-title">파트너 연결을 해제할까요?</h2>
          <p>장소·일정·추억은 {partnerName}의 공간에 남고, 나는 빈 공간에서 다시 시작해요.</p>
          <p>함께 쓰던 기록을 보려면 다시 연결해야 합니다.</p>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className={styles.dialogActions}>
            <button data-dialog-cancel type="button" disabled={pending} onClick={close}>취소</button>
            <button type="button" disabled={pending} onClick={() => void leave()}>{pending ? "해제하는 중…" : "연결 해제하기"}</button>
          </div>
        </div>
      </div>}
    </>
  );
}

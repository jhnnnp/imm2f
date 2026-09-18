"use client";

import Link from "next/link";
import { useState } from "react";
import { initialFromName } from "../types";
import { pairLabel, withAndParticle } from "../koreanName";
import { leaveCouple } from "../session";

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
  const youInitial = initialFromName(youName);
  const partnerInitial = initialFromName(partnerName);

  async function leave() {
    if (!confirm) {
      setConfirm(true);
      setError("");
      return;
    }
    setPending(true);
    setError("");
    const result = await leaveCouple();
    if (result?.error) {
      setError(result.error);
      setPending(false);
      setConfirm(false);
    }
  }

  return (
    <section className="partner-manage">
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
          <p>동네, 페이스, 못 먹는 음식을 남기면 해제보다 먼저 할 일이 생겨요. 점수가 아니라 타협안입니다.</p>
          <Link className="primary-button" href="/insights">우리 기준 열기</Link>
        </aside>
        <aside className="partner-manage-leave">
          <span className="eyebrow">SPACE RESET</span>
          <h3>연결을 해제할까요?</h3>
          <p>내가 나가면 장소·일정·추억은 {partnerName}의 공간에 남아요. 나는 빈 공간으로 다시 시작해요.</p>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <button
            className={`outline-button${confirm ? " is-confirm" : ""}`}
            type="button"
            onClick={() => void leave()}
            disabled={pending}
            aria-label={confirm ? "연결 해제를 한 번 더 확인" : "파트너 연결 해제"}
          >
            {pending ? "해제하는 중..." : confirm ? "정말 해제할까요?" : "연결 해제"}
          </button>
        </aside>
      </div>
    </section>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { loadCoupleActivities } from "../actions";
import { hrefForActivity, type CoupleActivity } from "../types";

function symbolFor(action: string) {
  if (action.startsWith("TRIP") || action.startsWith("DATE")) return { className: "activity-symbol", mark: "↗" };
  if (action === "PLACE_ADDED" || action === "PLACE_LIKED") return { className: "activity-symbol blue", mark: "♡" };
  if (action === "MEMORY_ADDED") return { className: "activity-symbol", mark: "♥" };
  if (action === "VAULT_UPDATED" || action === "GIFT_UPDATED" || action === "BUCKET_UPDATED") return { className: "activity-symbol blue", mark: "▣" };
  if (action === "PARTNER_JOINED") return { className: "activity-symbol", mark: "◎" };
  return { className: "activity-symbol blue", mark: "·" };
}

export function ActivityPanel() {
  const [items, setItems] = useState<CoupleActivity[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadCoupleActivities().then(next => {
      if (cancelled) return;
      setItems(next);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <div className="panel-heading">
        <div>
          <span className="eyebrow">TODAY</span>
          <h2>오늘의 이야기</h2>
        </div>
      </div>
      <div className="activity-feed">
        {!loaded && <p className="form-hint">활동을 불러오는 중이에요.</p>}
        {loaded && !items.length && (
          <p className="form-hint">아직 기록이 없어요. 장소를 저장하거나 일정을 바꾸면 여기에 쌓여요.</p>
        )}
        {items.map(item => {
          const symbol = symbolFor(item.action);
          return (
            <Link className={`activity-item ${item.important ? "important" : ""}`} href={hrefForActivity(item.action)} key={item.id}>
              <span className={symbol.className}>{symbol.mark}</span>
              <div>
                <b>{item.title}</b>
                <small>{item.actorName} · {item.createdAt}</small>
                {item.detail ? <p>{item.detail}</p> : null}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

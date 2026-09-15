"use client";

import { useEffect, useState } from "react";
import { loadPlanVersions } from "../actions";
import { restorePlanVersion } from "@/features/planning/actions";
import type { PlanItem, PlanKind } from "@/features/planning/types/plan";
import type { PlanVersion } from "../types";

export function VersionHistory({
  kind = "trip",
  latest,
  onRestore,
}: {
  kind?: PlanKind;
  latest?: number;
  onRestore?: (items: PlanItem[]) => void;
}) {
  const [versions, setVersions] = useState<PlanVersion[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void loadPlanVersions(kind).then(result => {
      if (cancelled) return;
      setVersions(result.versions);
      setLoaded(true);
      setSelectedId(result.versions[0]?.id ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [kind, latest]);

  const selected = versions.find(item => item.id === selectedId) ?? versions[0] ?? null;
  const shownLatest = latest && latest > 0 ? latest : versions[0]?.versionNumber ?? 0;

  async function restore() {
    if (!selected || !onRestore) return;
    setPending(true);
    setError("");
    const result = await restorePlanVersion(kind, selected.id);
    setPending(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    onRestore(result.items);
  }

  return (
    <div>
      <span className="eyebrow">PLAN HISTORY</span>
      <h2>변경 기록</h2>
      {!loaded && <p className="form-hint">버전을 불러오는 중이에요.</p>}
      {loaded && !versions.length && (
        <p className="form-hint">아직 저장된 버전이 없어요. 일정을 바꾸면 v1부터 쌓여요.</p>
      )}
      <div className="version-list">
        {versions.map(item => (
          <article key={item.id} className={selected?.id === item.id ? "is-selected" : ""}>
            <header>
              <b>v{item.versionNumber}</b>
              <span>{item.createdAt} · {item.createdByName}</span>
            </header>
            <p>{item.changeSummary}</p>
            <button type="button" onClick={() => setSelectedId(item.id)}>
              {selected?.id === item.id ? "보고 있는 버전" : "이 버전 보기"}
            </button>
          </article>
        ))}
      </div>
      {selected && (
        <div className="version-snapshot">
          <span className="eyebrow">SNAPSHOT · v{selected.versionNumber || shownLatest}</span>
          <ul>
            {selected.snapshot.map(item => (
              <li key={item.id}>
                <b>{item.startTime}</b> {item.placeName}
                <small>{item.category} · {item.durationMinutes}분</small>
              </li>
            ))}
          </ul>
          {onRestore && (
            <button className="primary-button full" type="button" onClick={() => void restore()} disabled={pending}>
              {pending ? "복원 중..." : "이 버전으로 복원"}
            </button>
          )}
          {error && <p className="form-error" role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}

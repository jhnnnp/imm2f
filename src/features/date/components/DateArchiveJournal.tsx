"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { HeaderActionIcon } from "@/components/shared/HeaderActionIcon";
import type { ArchivedDatePlan } from "@/features/planning/actions";
import { formatKoDate, formatKoShort } from "@/lib/dates";

function yearOf(iso: string) {
  return iso?.slice(0, 4) || "미정";
}

function monthOf(iso: string) {
  return iso?.slice(0, 7) || "미정";
}

function monthLabel(isoMonth: string) {
  const month = Number(isoMonth.slice(5, 7));
  return Number.isFinite(month) && month > 0 ? `${month}월` : "날짜 미정";
}

function listDateLabel(iso: string) {
  if (!iso) return "날짜 미정";
  const date = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.getFullYear() === new Date().getFullYear() ? formatKoShort(iso) : formatKoDate(iso).replace(/\s[^\s]+요일$/, "");
}

function matchesQuery(entry: ArchivedDatePlan, query: string) {
  if (!query) return true;
  const haystack = [
    entry.title,
    entry.notes,
    entry.date,
    ...entry.items.map(item => `${item.placeName} ${item.memo} ${item.category}`),
  ].join(" ").toLowerCase();
  return haystack.includes(query);
}

function groupEntries(dates: ArchivedDatePlan[]) {
  const years: Array<{ year: string; months: Array<{ key: string; label: string; items: ArchivedDatePlan[] }> }> = [];
  dates.forEach(entry => {
    const year = yearOf(entry.date);
    const monthKey = monthOf(entry.date);
    let yearGroup = years.find(item => item.year === year);
    if (!yearGroup) {
      yearGroup = { year, months: [] };
      years.push(yearGroup);
    }
    let monthGroup = yearGroup.months.find(item => item.key === monthKey);
    if (!monthGroup) {
      monthGroup = { key: monthKey, label: monthLabel(monthKey), items: [] };
      yearGroup.months.push(monthGroup);
    }
    monthGroup.items.push(entry);
  });
  return years;
}

export function DateArchiveJournal({
  dates,
  focusId,
  canRecord,
  recording,
  notice,
  onRecord,
  onDismissNotice,
}: {
  dates: ArchivedDatePlan[];
  focusId?: string;
  canRecord: boolean;
  recording?: boolean;
  notice: string;
  onRecord: () => void;
  onDismissNotice: () => void;
}) {
  const years = useMemo(
    () => [...new Set(dates.map(item => yearOf(item.date)))].sort((a, b) => {
      if (a === "미정") return 1;
      if (b === "미정") return -1;
      return b.localeCompare(a);
    }),
    [dates],
  );
  const [year, setYear] = useState("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(focusId || dates[0]?.id || "");

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return dates.filter(entry => (year === "all" || yearOf(entry.date) === year) && matchesQuery(entry, needle));
  }, [dates, query, year]);

  const groups = useMemo(() => groupEntries(visible), [visible]);
  const selected = visible.find(item => item.id === selectedId) ?? visible[0] ?? null;

  useEffect(() => {
    if (!focusId) return;
    setYear("all");
    setSelectedId(focusId);
  }, [focusId]);

  useEffect(() => {
    if (visible.some(item => item.id === selectedId)) return;
    setSelectedId(visible[0]?.id ?? "");
  }, [selectedId, visible]);

  return (
    <section className="date-archive date-journal-shell paper-card">
      <div className="date-archive-head">
        <div>
          <span className="eyebrow">OUR DATE JOURNAL</span>
          <h2>우리가 보낸 데이트</h2>
          <p>{dates.length ? `${dates.length}번의 하루가 날짜 순으로 쌓여 있어요.` : "다녀온 하루를 남기면, 둘만의 기록장이 시작돼요."}</p>
        </div>
        {canRecord && (
          <button className="date-action-button is-primary" type="button" onClick={onRecord} disabled={recording}>
            <HeaderActionIcon name="archive" />
            <span>{recording ? "남기는 중" : "오늘 데이트 남기기"}</span>
          </button>
        )}
      </div>
      {notice && (
        <p className="date-archive-notice" role="status">
          {notice}
          <button type="button" onClick={onDismissNotice} aria-label="알림 닫기">닫기</button>
        </p>
      )}
      {!dates.length ? (
        <div className="date-journal-empty">
          <h3>아직 남긴 데이트가 없어요</h3>
          <p>코스를 짜고 다녀온 뒤, 오늘 데이트를 남기면 이곳에 한 장씩 쌓입니다.</p>
        </div>
      ) : (
        <>
          <div className="date-journal">
            <div className="date-journal-index">
              {(years.length > 1 || dates.length >= 4) && (
                <div className="date-journal-index-tools">
                  {years.length > 1 && (
                    <div className="date-journal-years" role="tablist" aria-label="연도">
                      <button className={year === "all" ? "is-active" : ""} type="button" aria-pressed={year === "all"} onClick={() => setYear("all")}>전체</button>
                      {years.map(item => (
                        <button className={year === item ? "is-active" : ""} type="button" aria-pressed={year === item} onClick={() => setYear(item)} key={item}>{item}</button>
                      ))}
                    </div>
                  )}
                  {dates.length >= 4 && (
                    <label className="date-journal-search">
                      <span className="sr-only">지난 데이트 찾기</span>
                      <input value={query} onChange={event => setQuery(event.target.value)} placeholder="제목, 장소, 메모" autoComplete="off" />
                    </label>
                  )}
                </div>
              )}
              {groups.length ? groups.map(yearGroup => (
                <section key={yearGroup.year}>
                  <h3>{yearGroup.year === "미정" ? "날짜 미정" : `${yearGroup.year}년`}</h3>
                  {yearGroup.months.map(month => (
                    <div className="date-journal-month" key={month.key}>
                      <span>{month.label}</span>
                      <ul>
                        {month.items.map(entry => (
                          <li key={entry.id}>
                            <button
                              type="button"
                              className={selected?.id === entry.id ? "is-active" : ""}
                              aria-current={selected?.id === entry.id ? "true" : undefined}
                              onClick={() => setSelectedId(entry.id)}
                            >
                              <b>{listDateLabel(entry.date)}</b>
                              <strong>{entry.title}</strong>
                              <small>{entry.items.length ? `${entry.items.length}곳 · ${entry.items.map(item => item.placeName).slice(0, 2).join(" · ")}` : "장소 없음"}</small>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </section>
              )) : (
                <p className="date-journal-none">이 조건에 맞는 데이트가 없어요.</p>
              )}
            </div>
            {selected ? (
              <article className="date-journal-page" key={selected.id}>
                <span className="letter-pin" aria-hidden="true" />
                <header>
                  <span>{formatKoDate(selected.date)}</span>
                  <h3>{selected.title}</h3>
                  <p>{selected.items.length ? `${selected.items.length}곳을 이은 하루` : "장소 없이 남겨 둔 하루"}</p>
                </header>
                {selected.notes ? <p className="date-journal-letter">{selected.notes}</p> : <p className="date-journal-letter is-empty">그날의 메모는 비어 있어요.</p>}
                {selected.items.length > 0 && (
                  <ol>
                    {selected.items.map((item, index) => (
                      <li key={item.id}>
                        <em>{String(index + 1).padStart(2, "0")}</em>
                        <div>
                          <b>{item.placeName}</b>
                          <small>{item.memo || item.category}</small>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
                <Link className="text-link" href="/memories">추억 벽면에서 보기 →</Link>
              </article>
            ) : (
              <div className="date-journal-page is-empty">
                <p>왼쪽에서 하루를 고르면, 그날의 기록이 편지로 열려요.</p>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

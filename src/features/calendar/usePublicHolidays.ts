"use client";

import { useEffect, useRef, useState } from "react";

import type { HolidayResult } from "./holidays";

/** Keep a previously loaded year visible while a different month is loading. */
export function usePublicHolidays(years: number[]) {
  const cache = useRef(new Map<number, HolidayResult>());
  const [version, setVersion] = useState(0);
  const [results, setResults] = useState<HolidayResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const key = [...new Set(years)].sort().join(",");
  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    const requested = key.split(",").map(Number);
    const known = requested.flatMap(year => cache.current.has(year) ? [cache.current.get(year)!] : []);
    setResults(known); setLoading(true); setError("");
    void Promise.all(requested.map(async year => {
      const cached = cache.current.get(year);
      if (cached) return cached;
      const response = await fetch(`/api/calendar/holidays?year=${year}`, { signal: controller.signal });
      if (!response.ok) throw new Error("Holiday source unavailable");
      const result = await response.json() as HolidayResult;
      if (!result || !Array.isArray(result.holidays) || !["live", "cached", "unavailable"].includes(result.status)) throw new Error("Invalid holiday response");
      if (result.status !== "unavailable") cache.current.set(year, result);
      return result;
    })).then(next => {
      if (controller.signal.aborted) return;
      setResults(next);
      if (next.some(result => result.status === "unavailable")) setError("일부 연도의 공휴일 정보를 아직 확인하지 못했어요. 등록한 일정은 그대로 볼 수 있어요.");
    }).catch(() => {
      if (!controller.signal.aborted) setError("공휴일 정보를 불러오지 못했어요. 등록한 일정은 그대로 볼 수 있어요.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [key, version]);
  return { holidays: results.flatMap(result => result.holidays), source: results.find(result => result.source)?.source ?? "",
    message: results.map(result => result.message).filter(Boolean).filter((item, index, list) => list.indexOf(item) === index).join(" "),
    loading, error, retry: () => { cache.current.clear(); setVersion(current => current + 1); } };
}

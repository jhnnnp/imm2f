"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { preloadCoupleActivities } from "../activityClient";
import { hrefForActivity, type CoupleActivity } from "../types";

export function RecentActivityPreview() {
  const [items, setItems] = useState<CoupleActivity[]>([]);
  useEffect(() => { void preloadCoupleActivities(8).then(next => setItems(next.slice(0, 4))); }, []);
  if (!items.length) return <p className="form-hint">최근 활동을 불러오는 중이에요.</p>;
  return <>{items.map(item => <Link className="activity-line" href={hrefForActivity(item.action)} key={item.id}>
    <span className="avatar you">{item.actorName.slice(0, 1)}</span>
    <p><b>{item.title}</b><small>{item.detail || item.actorName}</small></p>
    <time>{item.createdAt}</time>
  </Link>)}</>;
}

"use client";

import { AppLink as Link } from "@/components/layout/AppLink";
import { useCoupleActivityFeed } from "../activityLive";
import { hrefForActivity } from "../types";

export function RecentActivityPreview() {
  const { items, loaded } = useCoupleActivityFeed(8);
  const preview = items.slice(0, 4);
  if (!loaded) return <p className="form-hint">최근 활동을 불러오는 중이에요.</p>;
  if (!preview.length) return <p className="form-hint">아직 나눌 변화가 없어요. 장소를 저장하면 여기에 남아요.</p>;
  return <>{preview.map(item => <Link className="activity-line" href={hrefForActivity(item.action)} key={item.id}>
    <span className="avatar you">{item.actorName.slice(0, 1)}</span>
    <p><b>{item.title}</b><small>{item.detail || item.actorName}</small></p>
    <time>{item.createdAt}</time>
  </Link>)}</>;
}

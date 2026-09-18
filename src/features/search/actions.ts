"use server";

import { listMemories } from "@/features/memories/actions";
import { listPlaces } from "@/features/places/actions";
import { loadCouplePlan } from "@/features/planning/actions";

export type WorkspaceHit = {
  href: string;
  label: string;
  detail: string;
  group: "장소" | "추억" | "일정";
};

export async function searchWorkspace(query: string): Promise<WorkspaceHit[]> {
  const q = query.trim().toLowerCase();
  const [{ places }, { memories }, trip, date] = await Promise.all([
    listPlaces(),
    listMemories({ photos: "none" }),
    loadCouplePlan("trip"),
    loadCouplePlan("date"),
  ]);

  const hits: WorkspaceHit[] = [
    ...places.map(place => ({
      href: `/places?selected=${place.id}`,
      label: place.name,
      detail: `${place.categoryLabel} · ${place.district}`,
      group: "장소" as const,
    })),
    ...memories.map(memory => ({
      href: "/memories",
      label: memory.title,
      detail: memory.locationLabel || memory.happenedOn,
      group: "추억" as const,
    })),
    ...(trip.items.length ? [{
      href: "/trip",
      label: trip.title || "우리가 고른 여행",
      detail: `${trip.items.length}곳`,
      group: "일정" as const,
    }] : []),
    ...(date.items.length ? [{
      href: "/date",
      label: date.title || "우리가 고른 데이트",
      detail: `${date.items.length}곳`,
      group: "일정" as const,
    }] : []),
  ];

  if (!q) return hits.slice(0, 8);
  return hits.filter(hit =>
    hit.label.toLowerCase().includes(q) || hit.detail.toLowerCase().includes(q),
  ).slice(0, 12);
}

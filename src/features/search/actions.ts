"use server";

import { listMemories } from "@/features/memories/actions";
import { listPlaces } from "@/features/places/actions";
import { loadCouplePlan } from "@/features/planning/actions";
import { withWorkspaceRead } from "@/lib/supabase/readContext";
import { getAppSession } from "@/features/auth/session";

export type WorkspaceHit = {
  href: string;
  label: string;
  detail: string;
  group: "장소" | "추억" | "일정";
};

export async function searchWorkspace(query: string): Promise<WorkspaceHit[]> {
  if (typeof query !== "string" || query.length > 256) return [];
  const q = query.normalize("NFKC").trim().toLowerCase();
  if (!q) return [];
  return withWorkspaceRead(async () => {
    if ((await getAppSession()).mode !== "authenticated") return [];
    const [{ places }, { memories }, trip, date] = await Promise.all([
      listPlaces(),
      listMemories({ photos: "none" }),
      loadCouplePlan("trip"),
      loadCouplePlan("date"),
    ]);

    const hits: WorkspaceHit[] = [
      ...places.map(place => ({
        href: `/places?selected=${encodeURIComponent(place.id)}`,
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

    const words = q.split(/\s+/);
    return hits.filter(hit => {
      const text = `${hit.label} ${hit.detail}`.normalize("NFKC").toLowerCase();
      return words.every(word => text.includes(word));
    }).slice(0, 12);
  });
}

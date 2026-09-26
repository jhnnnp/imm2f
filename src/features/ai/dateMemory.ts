import type { AIPlannerState } from "@/features/planning/types/plan";
import type { ArchivedDatePlan } from "@/features/planning/actions";
import type { TasteBoard } from "@/features/taste/types";
import type { DateActivityId, DateCuisineChoice } from "@/features/planning/types/plan";

export type DateEpisode = { placeName: string; reaction: "crowded" | "liked" | "disliked"; evidence: string; source: "archive" | "conversation"; confidence: number };
export type DateMemoryContext = {
  explicitProfile: { userCrowd: string | null; partnerCrowd: string | null; avoidFoods: string[];
    sharedActivities: DateActivityId[]; sharedCuisine: DateCuisineChoice | null };
  episodes: DateEpisode[];
  recentVisited: string[];
};

export function collectDateMemory(input: { taste: TasteBoard; archives: ArchivedDatePlan[]; userRequests: string[]; currentPlaces: string[] }): DateMemoryContext {
  const episodes: DateEpisode[] = [];
  const archived = input.archives.slice(0, 12);
  for (const entry of archived) {
    const note = entry.notes.trim();
    if (!note) continue;
    const place = entry.items.find(item => item.placeName && note.includes(item.placeName));
    if (!place) continue;
    if (/사람이\s*(?:너무\s*)?많|붐비|시끄럽|대기\s*(?:길|오래)|웨이팅/.test(note))
      episodes.push({ placeName: place.placeName, reaction: "crowded", evidence: note.slice(0, 160), source: "archive", confidence: 0.8 });
    if (/좋았|만족|또\s*가|마음에\s*들/.test(note))
      episodes.push({ placeName: place.placeName, reaction: "liked", evidence: note.slice(0, 160), source: "archive", confidence: 0.8 });
    if (/별로였|싫었|다신\s*안|불편했/.test(note))
      episodes.push({ placeName: place.placeName, reaction: "disliked", evidence: note.slice(0, 160), source: "archive", confidence: 0.8 });
  }
  for (const turn of input.userRequests.slice(-8)) {
    const place = input.currentPlaces.find(name => turn.includes(name));
    if (!place) continue;
    if (/사람이\s*(?:너무\s*)?많|붐비|시끄럽|웨이팅/.test(turn))
      episodes.push({ placeName: place, reaction: "crowded", evidence: turn.slice(0, 160), source: "conversation", confidence: 0.85 });
    if (/좋았|만족|또\s*가|마음에\s*들/.test(turn))
      episodes.push({ placeName: place, reaction: "liked", evidence: turn.slice(0, 160), source: "conversation", confidence: 0.85 });
    if (/별로였|싫었|다신\s*안|불편했/.test(turn))
      episodes.push({ placeName: place, reaction: "disliked", evidence: turn.slice(0, 160), source: "conversation", confidence: 0.85 });
  }
  return {
    explicitProfile: {
      userCrowd: input.taste.you?.crowd ?? null,
      partnerCrowd: input.taste.partner?.crowd ?? null,
      avoidFoods: [...new Set([...(input.taste.you?.avoidFoods ?? []), ...(input.taste.partner?.avoidFoods ?? [])])],
      sharedActivities: input.taste.you && input.taste.partner
        ? input.taste.you.activities.filter(activity => input.taste.partner!.activities.includes(activity)) : [],
      sharedCuisine: input.taste.you && input.taste.partner
        ? input.taste.you.cuisines.find(cuisine => cuisine !== "any" && input.taste.partner!.cuisines.includes(cuisine)) ?? null : null,
    },
    episodes: episodes.slice(-12),
    recentVisited: [...new Set(archived.flatMap(entry => entry.items.map(item => item.placeName)).filter(Boolean))].slice(0, 30),
  };
}

/** Persisted taste choices outrank inferred feedback; current-turn preferences outrank both. */
export function applyDateMemory(state: AIPlannerState, memory: DateMemoryContext): AIPlannerState {
  const crowdPreference = [memory.explicitProfile.userCrowd, memory.explicitProfile.partnerCrowd];
  const quietProfile = crowdPreference.filter(value => value === "quiet").length;
  const crowdedEpisodes = memory.episodes.filter(episode => episode.reaction === "crowded");
  const inferred = crowdedEpisodes.length ? [{ value: "혼잡한 장소를 피하는 편", confidence: Math.min(0.8, 0.55 + crowdedEpisodes.length * 0.05),
    evidence: crowdedEpisodes.at(-1)!.evidence }] : [];
  const previousInferred = state.inferredPreferences ?? [];
  return {
    ...state,
    preferences: { ...(state.preferences ?? { vibe: [] }),
      crowdTolerance: state.preferences?.crowdTolerance ?? (quietProfile === 2 ? 0.2
        : quietProfile === 1 && !crowdPreference.includes("lively") ? 0.35
          : crowdedEpisodes.length ? 0.35 : undefined) },
    memorySuggestions: { activities: state.memorySuggestions?.activities.length ? state.memorySuggestions.activities
      : memory.explicitProfile.sharedActivities,
      cuisine: state.memorySuggestions?.cuisine ?? memory.explicitProfile.sharedCuisine },
    memorySignals: memory.episodes.slice(-12).map(({ placeName, reaction, confidence }) => ({ placeName, reaction, confidence })),
    inferredPreferences: [...previousInferred, ...inferred]
      .filter((item, index, all) => all.findIndex(other => other.value === item.value && other.evidence === item.evidence) === index).slice(-8),
  };
}

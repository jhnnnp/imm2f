import type { AIPlannerState, DateActivityId } from "@/features/planning/types/plan";
import type { DiscoverCandidate } from "@/features/places/types/place";
import { candidateActivitySlot } from "@/features/ai/dateCourse";
import { dateCandidateKey } from "@/features/ai/dateCourse";
import { toDateIntent } from "@/features/ai/dateIntent";
import { completeFunctionCalls } from "./client";
import { isOpenAiConfigured } from "./env";
import type { DatePlanningStep, DateTaskObjective } from "./dateTaskPlanner";

export type DateResearchToolCall = { tool: "search_places"; region: string; query: string }
  | { tool: "verify_performance"; venueId: string }
  | { tool: "get_place_details"; venueId: string };

export function dateResearchCallKey(call: DateResearchToolCall) {
  return call.tool === "search_places" ? `${call.region}:${call.query}` : `${call.tool}:${call.venueId}`;
}

/** A full candidate count alone does not mean the requested experience is covered. */
export function needsDateResearch(state: AIPlannerState, candidateCount: number, missing: DateActivityId[], round: number) {
  if (candidateCount < 8 || missing.length > 0) return true;
  if (round > 0) return false;
  const preferences = state.preferences;
  return Boolean(preferences && (
    (preferences.novelty ?? 0) >= 0.7
    || (preferences.intimacy ?? 0) >= 0.7
    || (preferences.scenicPreference ?? 0) >= 0.7
    || (preferences.crowdTolerance ?? 1) <= 0.3
    || preferences.vibe.some(vibe => /사진|조용|특별|이색|경치|야경/.test(vibe))
  ));
}

/** Treat model-selected tools as untrusted requests, never as executable code. */
export function validateDateResearchCalls(raw: unknown, regions: string[], attempted: Set<string>, performanceVenueIds: string[] = [], detailVenueIds: string[] = []): DateResearchToolCall[] {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as { calls?: unknown }).calls)) return [];
  const result: DateResearchToolCall[] = [];
  for (const value of (raw as { calls: unknown[] }).calls.slice(0, 6)) {
    if (!value || typeof value !== "object") continue;
    const row = value as Record<string, unknown>;
    if (row.tool === "verify_performance" || row.tool === "get_place_details") {
      const allowed = row.tool === "verify_performance" ? performanceVenueIds : detailVenueIds;
      if (typeof row.venueId !== "string" || !allowed.includes(row.venueId)) continue;
      const call = { tool: row.tool, venueId: row.venueId } as const;
      if (attempted.has(dateResearchCallKey(call)) || result.some(other => dateResearchCallKey(other) === dateResearchCallKey(call))) continue;
      result.push(call);
      if (result.length === 4) break;
      continue;
    }
    if (row.tool !== "search_places" || typeof row.region !== "string" || !regions.includes(row.region)
      || typeof row.query !== "string") continue;
    const query = row.query.replace(/\s+/g, " ").trim().slice(0, 48);
    if (query.length < 2 || /https?:|[\n\r{}\[\]]/.test(query)) continue;
    const call = { tool: "search_places", region: row.region, query } as const;
    const key = dateResearchCallKey(call);
    if (attempted.has(key) || result.some(other => dateResearchCallKey(other) === key)) continue;
    result.push(call);
    if (result.length === 4) break;
  }
  return result;
}

/** The model chooses a bounded next action from observed search coverage. */
export async function planNextDateResearch(input: {
  state: AIPlannerState;
  candidates: DiscoverCandidate[];
  regions: string[];
  missing: DateActivityId[];
  attempted: Set<string>;
  previousSteps?: DatePlanningStep[];
  objectives?: DateTaskObjective[];
  canVerifyPerformances?: boolean;
  canInspectPlaces?: boolean;
  verifierIssues?: string[];
}): Promise<DateResearchToolCall[]> {
  if (!isOpenAiConfigured()) return [];
  const counts = input.candidates.reduce<Record<string, number>>((acc, item) => {
    const slot = candidateActivitySlot(item);
    acc[slot] = (acc[slot] ?? 0) + 1;
    return acc;
  }, {});
  const performanceVenueIds = input.canVerifyPerformances && input.state.dateLabel
    ? input.candidates.filter(item => candidateActivitySlot(item) === "performance" && !item.performanceEvent)
      .map(dateCandidateKey).filter(id => !input.attempted.has(`verify_performance:${id}`)).slice(0, 5) : [];
  const detailVenueIds = input.canInspectPlaces
    ? input.candidates.filter(item => !item.openingHours || item.expectedCostTwo == null)
      .map(dateCandidateKey).filter(id => !input.attempted.has(`get_place_details:${id}`)).slice(0, 6) : [];
  const calls = await completeFunctionCalls({
    timeoutMs: 7500, maxTokens: 600,
    tools: [
      { type: "function", function: { name: "search_places", description: "Search actual Korean place records in one allowed region. Place records do not prove hours, menu or a dated event.",
        parameters: { type: "object", properties: { region: { type: "string", enum: input.regions }, query: { type: "string" } },
          required: ["region", "query"], additionalProperties: false } } },
      ...(performanceVenueIds.length ? [{ type: "function" as const, function: {
        name: "verify_performance", description: "Check a discovered performance venue against the dated KOPIS event records.",
        parameters: { type: "object", properties: { venueId: { type: "string", enum: performanceVenueIds } },
          required: ["venueId"], additionalProperties: false },
      } }] : []),
      ...(detailVenueIds.length ? [{ type: "function" as const, function: {
        name: "get_place_details", description: "Read available saved or provider-cached details for an exact discovered venue. Missing hours or prices remain unknown.",
        parameters: { type: "object", properties: { venueId: { type: "string", enum: detailVenueIds } },
          required: ["venueId"], additionalProperties: false },
      } }] : []),
    ],
    messages: [
      { role: "system", content: [
        "Choose up to four function calls for a Korean date planner. Call a function only if it can improve the observed candidate pool or verify a dated event. Otherwise call none.",
        "Use only allowed regions and venue IDs. Prioritize missing explicit experiences and the date objective. If verifierIssues mention a route or schedule failure, search for a closer replacement experience instead of repeating the failed course. If a dated performance is requested and a performance venue is available, verify it before assuming a show exists. Use get_place_details for an exact candidate when its stored facts could matter; unknown hours or prices stay unknown. Never invent venue names, dates or facts. Do not repeat attempted calls. Place search does not prove opening hours, menu, showtime or booking.",
      ].join(" ") },
      { role: "user", content: JSON.stringify({ intent: toDateIntent(input.state), objectives: input.objectives,
        regions: input.regions, missing: input.missing, verifierIssues: input.verifierIssues?.slice(0, 8),
        counts, candidateCount: input.candidates.length, performanceVenueIds, detailVenueIds,
        attempted: [...input.attempted].slice(-30),
        previousOutcomes: (input.previousSteps ?? []).map(step => ({ calls: step.calls.map(dateResearchCallKey),
          added: step.newCandidateIds.length, verifiedEvents: step.newVerifiedEvents,
          enrichedDetails: step.newDetailedPlaces,
          remaining: step.missingAfter })) }) },
    ],
  });
  return validateDateResearchCalls({ calls: (calls ?? []).map(call => ({
    ...(call.arguments && typeof call.arguments === "object" && !Array.isArray(call.arguments) ? call.arguments : {}),
    tool: call.name,
  })) },
  input.regions, input.attempted, performanceVenueIds, detailVenueIds);
}

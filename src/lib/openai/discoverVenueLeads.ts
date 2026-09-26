import type { AIPlannerState } from "@/features/planning/types/plan";
import type { DiscoverCandidate } from "@/features/places/types/place";
import { selectedAreas } from "@/features/ai/dateBrief";
import { completeJsonWithWebSearch } from "./client";
import { isOpenAiConfigured } from "./env";

export type VenueLead = { name: string; region: string; role: "cafe" | "meal" | "exhibit" | "spot"; sourceUrl: string };
const LEAD_LIMIT = 6;

function canonicalUrl(raw: string) {
  try {
    const url = new URL(raw);
    if (!/^https?:$/.test(url.protocol)) return "";
    for (const key of [...url.searchParams.keys()]) if (/^utm_|^(fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
    return `${url.hostname.replace(/^www\./, "")}${url.pathname.replace(/\/$/, "")}`;
  } catch { return ""; }
}

/** Search results only propose names. Kakao must resolve their actual branch and role. */
export function sanitizeVenueLeads(raw: unknown, citedUrls: string[], regions: string[]): VenueLead[] {
  const rows = raw && typeof raw === "object" && Array.isArray((raw as { venues?: unknown }).venues)
    ? (raw as { venues: unknown[] }).venues : [];
  const citations = new Set(citedUrls.map(canonicalUrl).filter(Boolean));
  const seen = new Set<string>();
  const leads: VenueLead[] = [];
  for (const value of rows) {
    if (!value || typeof value !== "object") continue;
    const row = value as Record<string, unknown>;
    const name = typeof row.name === "string" ? row.name.replace(/\s+/g, " ").trim().slice(0, 70) : "";
    const region = typeof row.region === "string" ? row.region.trim() : "";
    const role = row.role;
    const sourceUrl = typeof row.sourceUrl === "string" ? row.sourceUrl.trim() : "";
    const key = `${region}:${name}`.replace(/\s/g, "").toLowerCase();
    if (name.length < 2 || /추천|맛집|카페거리|가볼만한곳/.test(name) || !regions.includes(region)
      || !["cafe", "meal", "exhibit", "spot"].includes(String(role))
      || !citations.has(canonicalUrl(sourceUrl)) || seen.has(key)) continue;
    seen.add(key);
    leads.push({ name, region, role: role as VenueLead["role"], sourceUrl });
    if (leads.length >= LEAD_LIMIT) break;
  }
  return leads;
}

export function leadMatchesCandidate(lead: VenueLead, candidate: DiscoverCandidate) {
  const normalized = (value: string) => value.normalize("NFKC").replace(/[^가-힣a-z0-9]/gi, "").toLowerCase();
  const category = candidate.detailedCategory || candidate.categoryLabel;
  const roleMatches = lead.role === "meal" ? candidate.category === "restaurant"
    : lead.role === "cafe" ? candidate.category === "cafe" && !/보드게임|만화카페|방탈출/.test(`${candidate.name} ${category}`)
      : lead.role === "exhibit" ? /미술|박물|전시|갤러리/.test(`${candidate.name} ${category}`)
        : candidate.category === "tourist" || candidate.category === "nature" || candidate.category === "photo";
  return roleMatches && normalized(candidate.name) === normalized(lead.name);
}

export async function discoverVenueLeads(state: AIPlannerState): Promise<VenueLead[]> {
  const regions = selectedAreas(state).slice(0, 2);
  const explicitRequest = state.userRequests?.at(-1)?.trim() ?? "";
  const priorities = state.discovery?.priorities?.length
    ? state.discovery.priorities
    : /예쁜|아름다운|분위기|인테리어|뷰|전망|한옥|정원|테라스|로스터리|디저트|맛있는|맛집|파스타|전시|공연/.test(explicitRequest)
      ? [explicitRequest.slice(0, 120)] : [];
  if (!isOpenAiConfigured() || !regions.length || (!priorities.length && !state.cuisine)) return [];
  let citedUrls: string[] = [];
  const raw = await completeJsonWithWebSearch<{ venues?: unknown }>({
    timeoutMs: 14000, maxTokens: 1100, requireSearch: true, searchContextSize: "medium",
    onSources: urls => { citedUrls = urls; },
    instructions: [
      "Find distinctive real Korean date venues for the supplied areas and requested qualities. Search editorial, venue-owned or map sources.",
      "Return up to six exact shop/venue branch names. The source must actually mention that name and the requested characteristic; do not invent or generalize a district guide into an individual venue.",
      "This is discovery only. Never claim a venue is beautiful, tasty, open, or bookable; another provider will verify identity and attributes.",
      'Schema: {"venues":[{"name":"exact venue name","region":"one supplied area","role":"cafe|meal|exhibit|spot","sourceUrl":"retrieved source URL"}]}. If none, venues:[].',
    ].join(" "),
    payload: { regions, priorities, cuisine: state.cuisine, requiredActivities: state.discovery?.requiredActivities ?? state.activities },
  });
  return sanitizeVenueLeads(raw, citedUrls, regions);
}

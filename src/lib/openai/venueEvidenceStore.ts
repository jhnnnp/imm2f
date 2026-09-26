import { createHash } from "node:crypto";
import type { DiscoverCandidate, VenueObservation } from "@/features/places/types/place";
import { createServiceClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { dateCandidateKey } from "@/features/ai/dateCourse";

type EvidenceRow = Database["public"]["Tables"]["venue_evidence"]["Row"];
type EvidenceInsert = Database["public"]["Tables"]["venue_evidence"]["Insert"];
const DAY_MS = 86_400_000;
const MAX_AGE_MS = 30 * DAY_MS;

function identity(value: string) {
  return value.normalize("NFKC").replace(/[^가-힣a-z0-9]/gi, "").toLowerCase();
}

function sameBranch(row: EvidenceRow, candidate: DiscoverCandidate) {
  const address = candidate.roadAddress || candidate.address;
  return row.external_source === candidate.externalSource
    && row.external_place_id === candidate.externalPlaceId
    && identity(row.branch_name) === identity(candidate.name)
    && identity(row.venue_address) === identity(address);
}

/** Reject stale, misattributed, or incomplete rows even if the database has them. */
export function storedVenueObservation(row: EvidenceRow, candidate: DiscoverCandidate, now = Date.now()): VenueObservation | null {
  const checked = Date.parse(row.checked_at);
  const maxAge = row.verification === "search_report" ? 7 * DAY_MS : MAX_AGE_MS;
  if (!sameBranch(row, candidate) || !Number.isFinite(checked) || checked > now || now - checked > maxAge
    || !row.source_excerpt?.trim() || !row.source_url.startsWith("https://")) return null;
  return {
    id: row.id, venueId: dateCandidateKey(candidate), branchName: candidate.name,
    text: row.observation, url: row.source_url, checkedAt: row.checked_at,
    attribute: row.attribute, verification: row.verification,
    sourceExcerpt: row.source_excerpt, sourceVenueName: row.source_venue_name,
    sourceAddress: row.source_address,
  };
}

function toInsert(candidate: DiscoverCandidate, observation: VenueObservation): EvidenceInsert | null {
  if (observation.venueId !== dateCandidateKey(candidate)
    || !observation.sourceExcerpt || !observation.sourceVenueName || !observation.sourceAddress
    || !observation.attribute || !observation.verification || !observation.url.startsWith("https://")) return null;
  const address = candidate.roadAddress || candidate.address;
  if (!candidate.name || !address) return null;
  const id = createHash("sha256").update(`${dateCandidateKey(candidate)}\0${observation.url}\0${observation.text}`).digest("hex");
  return {
    id, external_source: candidate.externalSource, external_place_id: candidate.externalPlaceId,
    branch_name: candidate.name, venue_address: address, attribute: observation.attribute,
    observation: observation.text, source_url: observation.url, source_excerpt: observation.sourceExcerpt,
    source_venue_name: observation.sourceVenueName, source_address: observation.sourceAddress,
    verification: observation.verification, checked_at: observation.checkedAt,
  };
}

export async function readVenueEvidence(candidates: DiscoverCandidate[]) {
  const result = new Map<string, VenueObservation[]>();
  if (!candidates.length) return result;
  const client = createServiceClient();
  if (!client) return result;
  try {
    const { data, error } = await client.from("venue_evidence")
      .select("id,external_source,external_place_id,branch_name,venue_address,attribute,observation,source_url,source_excerpt,source_venue_name,source_address,verification,checked_at,created_at")
      .in("external_place_id", [...new Set(candidates.map(candidate => candidate.externalPlaceId))])
      .gte("checked_at", new Date(Date.now() - MAX_AGE_MS).toISOString())
      .order("checked_at", { ascending: false });
    if (error || !data) return result;
    const byKey = new Map(candidates.map(candidate => [dateCandidateKey(candidate), candidate]));
    for (const row of data) {
      const key = `${row.external_source}:${row.external_place_id}`;
      const candidate = byKey.get(key);
      const observation = candidate && storedVenueObservation(row, candidate);
      if (!observation) continue;
      const items = result.get(key) ?? [];
      if (items.length < 4) result.set(key, [...items, observation]);
    }
  } catch {
    // A missing migration or provider outage must not stop the course.
  }
  return result;
}

export async function writeVenueEvidence(candidates: DiscoverCandidate[]) {
  const client = createServiceClient();
  if (!client) return;
  const rows = candidates.flatMap(candidate => (candidate.evidence ?? [])
    .map(observation => toInsert(candidate, observation)).filter((row): row is EvidenceInsert => Boolean(row)));
  if (!rows.length) return;
  try {
    const { error } = await client.from("venue_evidence").upsert(rows, { onConflict: "id" });
    if (error) console.warn("venue_evidence_write_unavailable", { code: error.code });
  } catch {
    // Evidence remains usable for this request even if persistence fails.
  }
}

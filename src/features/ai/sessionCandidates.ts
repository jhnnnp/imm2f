import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { AIPlannerReply, AIPlannerResult } from "@/features/planning/types/plan";
import type { DateCandidateRecord } from "./dateCandidatePool";
import type { DateEvidenceFact } from "./dateEvidence";
import type { DiscoverCandidate } from "@/features/places/types/place";
import { emptySessionFeedback, MAX_SESSION_FEEDBACK, type SessionFeedbackContext } from "./sessionFeedback";

export const MAX_SESSION_CANDIDATES = 80;
const MAX_FACT_VERSIONS = 3;
const MAX_EVIDENCE_PER_CANDIDATE = 6;
const MAX_EVENTS_PER_CANDIDATE = 12;
const MAX_SESSION_SERIALIZED_CHARS = 250_000;
const DAY_MS = 86_400_000;

export type SessionCandidateState = "discovered" | "eligible" | "shown" | "selected"
  | "rejected" | "replaced" | "stale";
export type CandidateSessionEvent = { candidateId: string; type: SessionCandidateState;
  turnId: string; observedAt: string; source: "candidate_pool" | "visible_result" | "current_plan";
  reason?: DateCandidateRecord["rejectedReasons"][number]; displayOrder?: number };
export type SessionCandidateFact = { value: DateCandidateRecord["facts"];
  observedAt: string; turnId: string; source: "candidate_pool" };
export type SessionCandidateEvidence = DateEvidenceFact & { observedAt: string; observedTurnId: string;
  freshnessCategory: "time_sensitive" | "stable" };
export type SessionCandidateRecord = {
  candidateId: string;
  /** Provider IDs are authoritative; internal IDs come only from a verified plan. */
  identity: { kind: "provider" | "internal" | "name_location"; key: string };
  venueId?: string;
  name: string;
  category?: string;
  area?: string;
  address?: string;
  /** Bounded provider snapshot for current-turn eligibility rechecks; never an authority for live facts. */
  venue?: DiscoverCandidate;
  currentState: SessionCandidateState;
  facts: SessionCandidateFact[];
  evidence: SessionCandidateEvidence[];
  rejectedReasons: DateCandidateRecord["rejectedReasons"];
  firstSeenTurn: string;
  lastSeenTurn: string;
  shownCount: number;
  selectedCount: number;
  events: CandidateSessionEvent[];
  source: "candidate_pool" | "current_plan";
};
export type SessionCandidateContext = {
  version: 1;
  sessionId: string;
  turnCount: number;
  records: SessionCandidateRecord[];
  selectedCandidateIds: string[];
  shownCandidateIds: string[];
  shownBatchTurnIds: string[];
  rejectedCandidateIds: string[];
  /** Current planning session only; signed with the candidate read model. */
  feedback?: SessionFeedbackContext;
  lastUpdatedAt: string | null;
  /** Server signature over the bounded read model; never supplied by the model. */
  signature?: string;
};
export type SessionCandidateMergeInfo = { sessionId: string; observedAt: string; turnId: string;
  shownPlaces?: Array<{ name: string; address?: string }>;
  previousPlan?: AIPlannerReply | null;
  currentPlan?: AIPlannerReply | null;
  reset?: boolean };

export function emptySessionCandidates(sessionId: string): SessionCandidateContext {
  return { version: 1, sessionId, turnCount: 0, records: [], selectedCandidateIds: [],
    shownCandidateIds: [], shownBatchTurnIds: [], rejectedCandidateIds: [],
    feedback: emptySessionFeedback(), lastUpdatedAt: null };
}

const signingKey = () => process.env.SESSION_CANDIDATE_SIGNING_KEY?.trim()
  || process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || null;
const unsigned = (context: SessionCandidateContext) => {
  const { signature: _signature, ...body } = context;
  return body;
};
const sign = (context: SessionCandidateContext, key: string) =>
  createHmac("sha256", key).update(JSON.stringify(unsigned(context))).digest("hex");

export function sealSessionCandidates(context: SessionCandidateContext): SessionCandidateContext {
  const key = signingKey();
  return key ? { ...context, signature: sign(context, key) } : context;
}

/** A client-carried session snapshot is accepted only when it is bounded and server-signed. */
export function verifiedSessionCandidates(value: unknown, sessionId: string): SessionCandidateContext | null {
  try {
    const key = signingKey();
    if (!key || !value || typeof value !== "object") return null;
    const context = value as SessionCandidateContext;
    if (context.version !== 1 || context.sessionId !== sessionId || !Array.isArray(context.records)
      || context.records.length > MAX_SESSION_CANDIDATES || typeof context.signature !== "string"
      || context.feedback && (context.feedback.version !== 1 || !Array.isArray(context.feedback.entries)
        || context.feedback.entries.length > MAX_SESSION_FEEDBACK)
      || !Array.isArray(context.shownBatchTurnIds) || context.shownBatchTurnIds.length > 8
      || !/^[a-f0-9]{64}$/.test(context.signature)) return null;
    const serialized = JSON.stringify(context);
    if (serialized.length > 300_000) return null;
    const actual = Buffer.from(context.signature, "hex");
    const expected = Buffer.from(sign(context, key), "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected) ? context : null;
  } catch { return null; }
}

const normalize = (value: string) => value.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
const fallbackId = (key: string) => `name_location:${createHash("sha256").update(key).digest("hex").slice(0, 20)}`;
const sameVenue = (a: SessionCandidateRecord, b: SessionCandidateRecord) =>
  a.identity.kind === b.identity.kind && a.identity.key === b.identity.key;

/** Never merge on name alone. A fallback identity needs an exact address and category. */
export function candidateSessionIdentity(input: { providerId?: string; venueId?: string;
  name: string; address?: string; category?: string }): SessionCandidateRecord["identity"] | null {
  if (input.providerId && /^(?:kakao|tourapi):\S+$/.test(input.providerId))
    return { kind: "provider", key: input.providerId };
  if (input.venueId) return { kind: "internal", key: input.venueId };
  if (input.name && input.address && input.category) return { kind: "name_location",
    key: `${normalize(input.name)}|${normalize(input.address)}|${normalize(input.category)}` };
  return null;
}

export function evidenceFreshnessCategory(attribute: DateEvidenceFact["attribute"]):
  SessionCandidateEvidence["freshnessCategory"] {
  return ["hours", "reservation", "event", "price"].includes(attribute) ? "time_sensitive" : "stable";
}

export function isSessionEvidenceStale(evidence: SessionCandidateEvidence, now: string): boolean {
  const seen = Date.parse(evidence.retrievedAt);
  const current = Date.parse(now);
  if (!Number.isFinite(seen) || !Number.isFinite(current)) return true;
  const maxAge = evidence.freshnessCategory === "time_sensitive" ? DAY_MS : 30 * DAY_MS;
  return current - seen > maxAge || seen > current + 5 * 60_000;
}

const evidenceKey = (fact: DateEvidenceFact) => [fact.attribute, fact.sourceUrl ?? "",
  fact.retrievedAt, fact.excerpt ?? "", fact.verification].join("\u0000");

function boundedEvents(events: CandidateSessionEvent[]): CandidateSessionEvent[] {
  if (events.length <= MAX_EVENTS_PER_CANDIDATE) return events;
  const retained = new Set<number>();
  const reasons = new Set<string>();
  for (let index = events.length - 1; index >= 0 && retained.size < MAX_EVENTS_PER_CANDIDATE; index--) {
    const event = events[index];
    if (event.type !== "rejected" || !event.reason || reasons.has(event.reason)) continue;
    reasons.add(event.reason); retained.add(index);
  }
  for (let index = events.length - 1; index >= 0 && retained.size < MAX_EVENTS_PER_CANDIDATE; index--)
    retained.add(index);
  return events.filter((_, index) => retained.has(index));
}

function addEvent(record: SessionCandidateRecord, type: SessionCandidateState,
  info: SessionCandidateMergeInfo, source: CandidateSessionEvent["source"], reason?: string,
  displayOrder?: number) {
  if (record.events.some(event => event.turnId === info.turnId && event.type === type && event.reason === reason)) return;
  record.events = boundedEvents([...record.events, { candidateId: record.candidateId, type,
    turnId: info.turnId, observedAt: info.observedAt, source, ...(reason ? { reason } : {}),
    ...(displayOrder != null ? { displayOrder } : {}) }]);
  record.currentState = type;
  if (type === "shown") record.shownCount += 1;
  if (type === "selected") record.selectedCount += 1;
}

function venueSnapshot(venue: DiscoverCandidate): DiscoverCandidate {
  const short = (value: string | undefined, max: number) => value?.slice(0, max);
  return {
    externalSource: venue.externalSource, externalPlaceId: venue.externalPlaceId,
    name: venue.name.slice(0, 120), category: venue.category,
    categoryLabel: venue.categoryLabel.slice(0, 120), district: venue.district.slice(0, 120),
    address: venue.address.slice(0, 240), roadAddress: venue.roadAddress.slice(0, 240),
    phone: venue.phone.slice(0, 60), mapUrl: venue.mapUrl.slice(0, 500),
    coordinates: [...venue.coordinates] as [number, number],
    expectedCostTwo: venue.expectedCostTwo,
    evidence: (venue.evidence ?? []).slice(0, 6).map(item => ({ ...item,
      text: item.text.slice(0, 300), sourceExcerpt: short(item.sourceExcerpt, 300),
      url: item.url.slice(0, 500) })),
    performanceEvent: venue.performanceEvent ? { ...venue.performanceEvent,
      showtimes: venue.performanceEvent.showtimes.slice(0, 8),
      sourceUrl: venue.performanceEvent.sourceUrl.slice(0, 500) } : undefined,
    image: short(venue.image, 500), detailedCategory: short(venue.detailedCategory, 180),
    kakaoCategoryGroupCode: venue.kakaoCategoryGroupCode,
    searchRegion: short(venue.searchRegion, 120), distanceMeters: venue.distanceMeters,
    openingHours: short(venue.openingHours, 180), rating: venue.rating,
    ratingCount: venue.ratingCount, dishes: short(venue.dishes, 180),
    factSourceUrl: short(venue.factSourceUrl, 500), factNote: short(venue.factNote, 280),
  };
}

function fromPool(record: DateCandidateRecord, info: SessionCandidateMergeInfo): SessionCandidateRecord | null {
  const identity = candidateSessionIdentity({ providerId: record.id, name: record.venue.name,
    address: record.venue.address || record.venue.roadAddress, category: record.venue.category });
  if (!identity) return null;
  return { candidateId: identity.kind === "provider" ? record.id : fallbackId(identity.key),
    identity, name: record.venue.name, venue: venueSnapshot(record.venue),
    category: record.venue.category, area: record.venue.district,
    address: record.venue.address || record.venue.roadAddress, currentState: "discovered",
    facts: [], evidence: [], rejectedReasons: [], firstSeenTurn: info.turnId,
    lastSeenTurn: info.turnId, shownCount: 0, selectedCount: 0, events: [], source: "candidate_pool" };
}

function planCandidateId(place: AIPlannerReply["recommendations"][number]): string {
  if (/^(?:kakao|tourapi):\S+$/.test(place.id)) return place.id;
  if (place.placeId) return `internal:${place.placeId}`;
  return fallbackId(`${normalize(place.name)}|${normalize(place.address ?? "")}|${normalize(place.category)}`);
}

function fromPlan(place: AIPlannerReply["recommendations"][number],
  info: SessionCandidateMergeInfo): SessionCandidateRecord {
  const candidateId = planCandidateId(place);
  return { candidateId, identity: candidateSessionIdentity({ providerId: place.id,
    venueId: place.placeId, name: place.name, address: place.address, category: place.category })!,
    venueId: place.placeId, name: place.name, category: place.category, area: place.district,
    address: place.address, currentState: "discovered", facts: [], evidence: [],
    rejectedReasons: [], firstSeenTurn: info.turnId, lastSeenTurn: info.turnId,
    shownCount: 0, selectedCount: 0, events: [], source: "current_plan" };
}

function resolveShown(records: SessionCandidateRecord[], shown: { name: string; address?: string }):
  SessionCandidateRecord | null {
  const matches = records.filter(row => normalize(row.name) === normalize(shown.name)
    && (!shown.address || row.address && normalize(row.address) === normalize(shown.address)));
  return matches.length === 1 ? matches[0] : null;
}

const importance = (row: SessionCandidateRecord) => row.currentState === "selected" ? 4
  : row.rejectedReasons.length ? 3 : row.shownCount ? 2 : row.currentState === "stale" ? 0 : 1;
const byImportance = (a: SessionCandidateRecord, b: SessionCandidateRecord) => importance(b) - importance(a)
  || Date.parse(b.events.at(-1)?.observedAt ?? "") - Date.parse(a.events.at(-1)?.observedAt ?? "");
function prune(records: SessionCandidateRecord[]): SessionCandidateRecord[] {
  let retained = records.length > MAX_SESSION_CANDIDATES
    ? [...records].sort(byImportance).slice(0, MAX_SESSION_CANDIDATES) : records;
  if (JSON.stringify(retained).length > MAX_SESSION_SERIALIZED_CHARS) {
    retained = [...retained].sort(byImportance);
    while (retained.length && JSON.stringify(retained).length > MAX_SESSION_SERIALIZED_CHARS) retained.pop();
  }
  return retained;
}

/** Pure session read-state merge. It never changes the pool's eligible candidates or scores. */
export function mergeSessionCandidates(previous: SessionCandidateContext | null | undefined,
  currentRecords: DateCandidateRecord[], info: SessionCandidateMergeInfo): SessionCandidateContext {
  const base = !info.reset && previous?.version === 1 && previous.sessionId === info.sessionId
    ? previous : emptySessionCandidates(info.sessionId);
  const records = base.records.map(row => ({ ...row, identity: { ...row.identity },
    facts: [...row.facts], evidence: [...row.evidence], rejectedReasons: [...row.rejectedReasons],
    events: [...row.events] }));
  for (const row of records) {
    const latest = Date.parse(row.events.at(-1)?.observedAt ?? "");
    const now = Date.parse(info.observedAt);
    if (["discovered", "eligible", "stale"].includes(row.currentState)
      && Number.isFinite(latest) && Number.isFinite(now) && now - latest > 7 * DAY_MS)
      addEvent(row, "stale", info, "candidate_pool");
  }
  const find = (candidate: SessionCandidateRecord) => records.find(row => sameVenue(row, candidate));
  for (const current of currentRecords) {
    const candidate = fromPool(current, info);
    if (!candidate) continue;
    let row = find(candidate);
    if (!row) { row = candidate; records.push(row); addEvent(row, "discovered", info, "candidate_pool"); }
    row.lastSeenTurn = info.turnId;
    row.name = current.venue.name;
    row.category = current.venue.category;
    row.area = current.venue.district;
    row.address = current.venue.address || current.venue.roadAddress;
    row.venue = venueSnapshot(current.venue);
    const facts: SessionCandidateFact = { value: { ...current.facts }, observedAt: info.observedAt,
      turnId: info.turnId, source: "candidate_pool" };
    if (!row.facts.some(item => item.turnId === info.turnId && JSON.stringify(item.value) === JSON.stringify(facts.value)))
      row.facts = [...row.facts, facts].slice(-MAX_FACT_VERSIONS);
    const seenEvidence = new Set(row.evidence.map(evidenceKey));
    for (const evidence of current.evidence) {
      const key = evidenceKey(evidence);
      if (seenEvidence.has(key)) continue;
      seenEvidence.add(key);
      row.evidence.push({ ...evidence, observedAt: info.observedAt, observedTurnId: info.turnId,
        freshnessCategory: evidenceFreshnessCategory(evidence.attribute) });
    }
    if (row.evidence.length > MAX_EVIDENCE_PER_CANDIDATE) {
      // Retain checked/provider provenance before unverified leads when the bounded session fills up.
      row.evidence = [...row.evidence].sort((a, b) => {
        const quality = (fact: SessionCandidateEvidence) => fact.verification === "source_checked" ? 3
          : fact.verification === "provider" ? 2 : fact.verification === "search_report" ? 1 : 0;
        return quality(b) - quality(a) || b.retrievedAt.localeCompare(a.retrievedAt);
      }).slice(0, MAX_EVIDENCE_PER_CANDIDATE);
    }
    if (current.rejectedReasons.length) {
      for (const reason of current.rejectedReasons) {
        if (!row.rejectedReasons.includes(reason)) row.rejectedReasons.push(reason);
        addEvent(row, "rejected", info, "candidate_pool", reason);
      }
    } else if (row.currentState !== "selected" && row.currentState !== "shown")
      addEvent(row, "eligible", info, "candidate_pool");
  }
  let shownInTurn = false;
  for (const [index, shown] of (info.shownPlaces ?? []).entries()) {
    const row = resolveShown(records, shown);
    if (row) { addEvent(row, "shown", info, "visible_result", undefined, index); shownInTurn = true; }
  }
  const selected = info.currentPlan?.recommendations ?? info.previousPlan?.recommendations ?? [];
  const selectedIds = new Set<string>();
  for (const place of selected) {
    const candidate = fromPlan(place, info);
    let row = find(candidate);
    if (!row) { row = candidate; records.push(row); addEvent(row, "discovered", info, "current_plan"); }
    row.venueId = place.placeId;
    row.name = place.name;
    row.lastSeenTurn = info.turnId;
    selectedIds.add(row.candidateId);
    if (row.currentState !== "selected") addEvent(row, "selected", info, "current_plan");
  }
  for (const row of records) if (row.currentState === "selected" && !selectedIds.has(row.candidateId))
    addEvent(row, "replaced", info, "current_plan");
  const retained = prune(records);
  return { version: 1, sessionId: info.sessionId, turnCount: base.turnCount + 1,
    records: retained, selectedCandidateIds: retained.filter(row => row.currentState === "selected")
      .map(row => row.candidateId),
    shownCandidateIds: retained.filter(row => row.shownCount > 0).map(row => row.candidateId),
    shownBatchTurnIds: shownInTurn ? [...(base.shownBatchTurnIds ?? []), info.turnId].slice(-8)
      : [...(base.shownBatchTurnIds ?? [])],
    rejectedCandidateIds: retained.filter(row => row.rejectedReasons.length > 0).map(row => row.candidateId),
    feedback: base.feedback ?? emptySessionFeedback(),
    lastUpdatedAt: info.observedAt };
}

export function sessionShownPlaces(result: AIPlannerResult): Array<{ name: string; address?: string }> {
  if (result.card.stops?.length) return result.card.stops.map(stop => ({ name: stop.name,
    ...(stop.address ? { address: stop.address } : {}) }));
  return [];
}

/** Pure inventory for a future recommendation executor; no search or scoring occurs here. */
export function getReusableCandidates(context: SessionCandidateContext, now: string) {
  const stale = context.records.filter(row => row.currentState === "stale"
    || row.evidence.some(fact => isSessionEvidenceStale(fact, now))
    || row.facts.some(fact => fact.value.openingHours && Date.parse(now) - Date.parse(fact.observedAt) > DAY_MS));
  return {
    alreadyShownIds: [...context.shownCandidateIds], selectedIds: [...context.selectedCandidateIds],
    rejectedIds: [...context.rejectedCandidateIds],
    unseenEligibleIds: context.records.filter(row => row.currentState === "eligible" && !row.shownCount
      && !row.rejectedReasons.length).map(row => row.candidateId),
    priorRejectedReasons: Object.fromEntries(context.records.filter(row => row.rejectedReasons.length)
      .map(row => [row.candidateId, [...row.rejectedReasons]])),
    previouslyShown: context.records.filter(row => row.shownCount > 0),
    rejected: context.records.filter(row => row.rejectedReasons.length > 0), stale,
  };
}

/** Resolve only explicit, uniquely attributable references to places actually shown in this session. */
export function resolveSessionShownReference(context: SessionCandidateContext, phrase: string):
  SessionCandidateRecord | null {
  const shown = context.records.filter(row => row.shownCount > 0);
  const compact = normalize(phrase);
  const named = shown.filter(row => compact.includes(normalize(row.name)));
  if (named.length > 1) return null;
  if (!/아까|이전에|전에|보여준/.test(phrase)) return named[0] ?? null;
  const match = phrase.match(/(?:([1-9]\d*)|첫|두|세)\s*번째/);
  if (!match) return named[0] ?? (shown.length === 1 ? shown[0] : null);
  const ordinal = match[1] ? Number(match[1]) : /첫/.test(match[0]) ? 1 : /두/.test(match[0]) ? 2 : 3;
  const lastTurn = context.shownBatchTurnIds.at(-1);
  const lastShown = shown.filter(row => row.events.some(event => event.type === "shown" && event.turnId === lastTurn))
    .sort((a, b) => (a.events.find(event => event.type === "shown" && event.turnId === lastTurn)?.displayOrder ?? 0)
      - (b.events.find(event => event.type === "shown" && event.turnId === lastTurn)?.displayOrder ?? 0));
  const selected = lastShown[ordinal - 1] ?? null;
  return named.length === 1 && named[0].candidateId !== selected?.candidateId ? null : selected;
}

/** A named historical rejection is usable only when exactly one venue has that name. */
export function resolveSessionRejectedReference(context: SessionCandidateContext, phrase: string):
  SessionCandidateRecord | null {
  const matches = context.records.filter(row => row.rejectedReasons.length
    && row.name.length >= 2 && normalize(phrase).includes(normalize(row.name)));
  return matches.length === 1 ? matches[0] : null;
}

export function candidateSessionCounts(context: SessionCandidateContext) {
  return { totalCandidates: context.records.length,
    shownCount: context.shownCandidateIds.length, selectedCount: context.selectedCandidateIds.length,
    rejectedCount: context.rejectedCandidateIds.length,
    staleCount: context.lastUpdatedAt ? getReusableCandidates(context, context.lastUpdatedAt).stale.length : 0,
    evidenceCount: context.records.reduce((total, row) => total + row.evidence.length, 0) };
}

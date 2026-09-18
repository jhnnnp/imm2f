import type { DiscoverCandidate } from "@/features/places/types/place";
import type { AIChatCard, DateChatTurn, PlaceAsk } from "@/features/planning/types/plan";
import {
  PLACE_PICK_MAX,
  PLACE_PICK_MIN,
  buildPlaceCard,
  fallbackPlaceIntro,
  heuristicPlacePicks,
  sanitizePlacePicks,
} from "@/features/ai/placeRecommend";
import { dateCandidateKey, dateCategoryLabel } from "@/features/ai/dateCourse";
import { completeJson, completeJsonWithWebSearch } from "./client";
import { isOpenAiConfigured } from "./env";
import { applyPlaceWebFacts, sanitizePlaceWebFacts, type PlaceWebFact } from "./placeWebFacts";
import { writePlaceDetailCache } from "@/lib/places/detailCache";

export type PlaceRecommendation = {
  card: AIChatCard;
  shownPlaces: string[];
  source: "openai" | "fallback";
  candidates: DiscoverCandidate[];
};

/** How many shops get a live public-fact lookup per request. Cached facts skip the lookup. */
const FACT_LOOKUP_LIMIT = 6;
const FACT_LOOKUP_TIMEOUT_MS = 25000;
const WRITER_TIMEOUT_MS = 20000;

const SINGLE_PLACE_FACTS_PROMPT = [
  "You look up public facts for exactly one Korean shop. You have web_search and Korea location is set.",
  "Search '{name} {address}' and, if needed, '{name} {district} 네이버 플레이스' or '카카오맵'. Prefer a 네이버 플레이스 or 카카오맵 page; use another site only when neither shows this shop. Use only a page that is clearly this exact shop at this address.",
  "Copy as shown: star rating (0-5), review count, one short line of signature dishes or what people order (food), and one factual note such as 예약 가능, 웨이팅 잦음, 브레이크타임 15-17시, 테라스 있음, 화요일 휴무.",
  "Never invent or estimate. If a value is not visible, omit that key. Never write vibe words as food.",
  "sourceUrl must be the page you read (place.map.kakao.com/ID, map.naver.com/..., or the shop's own site).",
  "Return one raw JSON object only: {\"id\":string,\"rating\":number,\"ratingCount\":number,\"food\":string,\"note\":string,\"sourceUrl\":string}",
].join(" ");

const PLACE_WRITER_PROMPT = [
  "You are a warm local friend inside a couple's date app, helping them pick where to go. Write Korean 해요체 (~해요, ~드릴게요). Never 반말. No emoji, no markdown.",
  "candidates[] are real shops from Kakao Local with the public facts we verified (rating, ratingCount, food, note, sourceUrl). You may only pick ids from candidates[]. Never invent a shop, dish, price, or rating; use only what is in the row.",
  `Pick ${PLACE_PICK_MIN} to ${PLACE_PICK_MAX} that best match the ask (dish, cuisine, vibe words) and the couple's tastes. Prefer rows with a verified rating and more reviews, then variety. Skip rows that clearly miss the ask (a pizzeria for 초밥).`,
  "intro: 1-2 sentences that answer the ask directly and say how you chose (e.g. 후기 많은 순으로, 파스타로 알려진 곳 위주로). Mention the area.",
  "why: one concrete sentence per pick using the row: what to order (food), the rating and review count if present (e.g. 후기 51개에 4.5점), the note, or the leaf category and the walk from the area anchor (distanceMeters). Do not repeat the shop name. Do not restate the street address. Never write filler like 위치해 있어 접근성이 좋습니다 or ~에 있습니다.",
  "Return JSON only: {\"intro\":string,\"picks\":[{\"id\":string,\"why\":string}]}",
].join(" ");

function catalogRow(candidate: DiscoverCandidate, savedNames: Set<string>, bothWant: Set<string>) {
  return {
    id: dateCandidateKey(candidate),
    name: candidate.name,
    leaf: candidate.detailedCategory || dateCategoryLabel(candidate),
    district: candidate.district,
    address: candidate.roadAddress || candidate.address,
    saved: savedNames.has(candidate.name),
    bothWant: bothWant.has(candidate.name),
    distanceMeters: candidate.distanceMeters ?? null,
    rating: candidate.rating ?? null,
    ratingCount: candidate.ratingCount ?? null,
    food: candidate.dishes ?? null,
    note: candidate.factNote ?? null,
    sourceUrl: candidate.factSourceUrl ?? null,
  };
}

async function lookupPlaceFacts(candidates: DiscoverCandidate[], allowedIds: Set<string>): Promise<PlaceWebFact[]> {
  const targets = candidates.filter(candidate => candidate.rating == null && !candidate.dishes).slice(0, FACT_LOOKUP_LIMIT);
  if (!targets.length) return [];
  const rows = await Promise.all(targets.map(async candidate => {
    try {
      return await completeJsonWithWebSearch<Record<string, unknown>>({
        instructions: SINGLE_PLACE_FACTS_PROMPT,
        payload: {
          id: dateCandidateKey(candidate),
          name: candidate.name,
          address: candidate.roadAddress || candidate.address,
          district: candidate.district,
          leaf: candidate.detailedCategory || dateCategoryLabel(candidate),
        },
        maxTokens: 500,
        timeoutMs: FACT_LOOKUP_TIMEOUT_MS,
        requireSearch: true,
        searchContextSize: "low",
      });
    } catch {
      return null;
    }
  }));
  return sanitizePlaceWebFacts(
    rows.map((row, index) => (row ? { ...row, id: dateCandidateKey(targets[index]) } : null)).filter(Boolean),
    allowedIds,
  );
}

export async function recommendPlacesWithOpenAi(input: {
  message: string;
  ask: PlaceAsk;
  candidates: DiscoverCandidate[];
  savedNames: Set<string>;
  bothWant: Set<string>;
  coupleTaste: { summary: string; commonTastes: string[]; avoidFoods: string[] };
  conversation?: DateChatTurn[];
  alreadyShown: string[];
}): Promise<PlaceRecommendation> {
  const fallback = (pool: DiscoverCandidate[]): PlaceRecommendation => {
    const picks = heuristicPlacePicks(pool);
    return {
      card: buildPlaceCard({
        ask: input.ask,
        picks: picks.map(candidate => ({ candidate, why: "" })),
        intro: fallbackPlaceIntro(input.ask, picks.length),
        savedNames: input.savedNames,
      }),
      shownPlaces: picks.map(candidate => candidate.name),
      source: "fallback",
      candidates: pool,
    };
  };
  if (!isOpenAiConfigured() || !input.candidates.length) return fallback(input.candidates);

  const allowedIds = new Set(input.candidates.map(dateCandidateKey));
  const facts = await lookupPlaceFacts(input.candidates, allowedIds);
  const grounded = facts.length ? applyPlaceWebFacts(input.candidates, facts) : input.candidates;
  if (facts.length) void writePlaceDetailCache(grounded.filter(candidate => facts.some(fact => fact.id === dateCandidateKey(candidate))));

  const payload = {
    ask: {
      latestMessage: input.message.slice(0, 500),
      kind: input.ask.kind,
      query: input.ask.query,
      area: input.ask.area,
      alreadyShown: input.alreadyShown.slice(0, 10),
    },
    recentTurns: (input.conversation ?? []).slice(-6),
    couple: input.coupleTaste,
    candidates: grounded.map(candidate => catalogRow(candidate, input.savedNames, input.bothWant)),
  };

  try {
    const written = await completeJson<{ intro?: unknown; picks?: unknown }>({
      temperature: 0.4,
      maxTokens: 900,
      reasoningEffort: "low",
      timeoutMs: WRITER_TIMEOUT_MS,
      messages: [
        { role: "system", content: PLACE_WRITER_PROMPT },
        { role: "user", content: JSON.stringify(payload) },
      ],
    });
    const picks = sanitizePlacePicks(written?.picks, allowedIds);
    if (picks.length < Math.min(PLACE_PICK_MIN, grounded.length)) return fallback(grounded);
    const byId = new Map(grounded.map(candidate => [dateCandidateKey(candidate), candidate]));
    const chosen = picks
      .map(pick => ({ candidate: byId.get(pick.id), why: pick.why }))
      .filter((pick): pick is { candidate: DiscoverCandidate; why: string } => Boolean(pick.candidate));
    return {
      card: buildPlaceCard({ ask: input.ask, picks: chosen, intro: String(written?.intro ?? ""), savedNames: input.savedNames }),
      shownPlaces: chosen.map(pick => pick.candidate.name),
      source: "openai",
      candidates: grounded,
    };
  } catch {
    return fallback(grounded);
  }
}

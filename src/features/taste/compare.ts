import { emptyDateBrief } from "@/features/ai/dateBrief";
import type { AIPlannerState, DateActivityId, DateAreaScope, DateCuisineChoice } from "@/features/planning/types/plan";
import {
  canonicalizeArea,
  labelForActivity,
  labelForCrowd,
  labelForCuisine,
  labelForDateFlow,
  labelForDrink,
  labelForPace,
  labelForSetting,
  labelForScope,
  labelForTime,
} from "./options";
import { findRegionByArea } from "./areaCatalog";
import type { TasteCompare, TasteDateSeed, TasteDifference, TasteProfile } from "./types";

function overlap<T>(left: T[], right: T[]) {
  return left.filter(item => right.includes(item));
}

function onlyIn<T>(left: T[], right: T[]) {
  return left.filter(item => !right.includes(item));
}

function plannerPace(pace: TasteProfile["pace"]): AIPlannerState["pace"] {
  if (pace === "linger") return "relaxed";
  if (pace === "walk") return "active";
  return "balanced";
}

function mixScope(left: DateAreaScope, right: DateAreaScope): DateAreaScope {
  if (left === "core" || right === "core") return "core";
  if (left === "walkable" || right === "walkable") return "walkable";
  return "nearby";
}

function cuisineSeed(you: TasteProfile, partner: TasteProfile): DateCuisineChoice {
  const shared = overlap(you.cuisines, partner.cuisines).filter(item => item !== "any");
  if (shared.length === 1) return shared[0];
  if (shared.length > 1) return "any";
  const unrestricted = you.cuisines.includes("any") ? partner.cuisines
    : partner.cuisines.includes("any") ? you.cuisines : [];
  const specific = unrestricted.filter(item => item !== "any");
  return specific.length === 1 ? specific[0] : "any";
}

function activitySeed(you: TasteProfile, partner: TasteProfile): DateActivityId[] {
  const shared = overlap(you.activities, partner.activities);
  if (shared.length) return shared.slice(0, 3);
  return [...new Set([you.activities[0], partner.activities[0], ...you.activities.slice(1), ...partner.activities.slice(1)])]
    .filter((item): item is DateActivityId => Boolean(item)).slice(0, 3);
}

function areaSeed(you: TasteProfile, partner: TasteProfile) {
  const shared = overlap(you.areas, partner.areas);
  if (shared.length) return shared.slice(0, 1);
  // A catalog region is a candidate grouping, never proof of walking distance.
  // Keep one anchor even when both people picked far-apart towns in that region.
  const sameRegion = you.areas.find(area => {
    const region = findRegionByArea(canonicalizeArea(area));
    return region && partner.areas.some(other => findRegionByArea(canonicalizeArea(other))?.id === region.id);
  });
  return [sameRegion ?? you.areas[0] ?? partner.areas[0]].filter((area): area is string => Boolean(area));
}

function timeSeed(you: TasteProfile, partner: TasteProfile) {
  if (you.timeWindow === partner.timeWindow) return you.timeWindow;
  if (you.timeWindow === "any") return partner.timeWindow;
  if (partner.timeWindow === "any") return you.timeWindow;
  return "any" as const;
}

function flowSeed(you: TasteProfile, partner: TasteProfile) {
  if (you.dateFlow === partner.dateFlow) return you.dateFlow;
  return "flex";
}

function drinkSeed(you: TasteProfile, partner: TasteProfile): TasteProfile["drink"] {
  if (you.drink === partner.drink) return you.drink;
  if (you.drink === "none" || partner.drink === "none") return "none";
  if (you.drink === "light" || partner.drink === "light") return "light";
  return "any";
}

function indoorSeed(you: TasteProfile, partner: TasteProfile) {
  const wants = you.activities.includes("indoor") || partner.activities.includes("indoor");
  if (!wants) return null;
  if (you.indoorPlay && you.indoorPlay === partner.indoorPlay) return you.indoorPlay;
  if (you.indoorPlay === "상관없음") return partner.indoorPlay || "상관없음";
  if (partner.indoorPlay === "상관없음") return you.indoorPlay || "상관없음";
  if (!you.indoorPlay) return partner.indoorPlay || "상관없음";
  if (!partner.indoorPlay) return you.indoorPlay;
  return null;
}

function sharedSetting(you: TasteProfile, partner: TasteProfile): TasteProfile["setting"] {
  if (you.setting === partner.setting) return you.setting;
  if (you.setting === "mix") return partner.setting;
  if (partner.setting === "mix") return you.setting;
  return "mix";
}

function sharedCrowd(you: TasteProfile, partner: TasteProfile): TasteProfile["crowd"] {
  if (you.crowd === partner.crowd) return you.crowd;
  if (you.crowd === "mix") return partner.crowd;
  if (partner.crowd === "mix") return you.crowd;
  return "quiet";
}

function areaBridge(you: TasteProfile, partner: TasteProfile, anchor: string | undefined): TasteDifference | null {
  if (overlap(you.areas, partner.areas).length) return null;
  return {
    topic: "동네",
    you: you.areas.join(", "),
    partner: partner.areas.join(", "),
    bridge: anchor ? `기본 후보는 ${anchor}예요. 서로 고른 동네를 한 코스에 합치기 전에 이번에 갈 동네부터 골라 주세요.`
      : "함께 갈 동네를 먼저 골라 주세요.",
  };
}

function cuisineBridge(you: TasteProfile, partner: TasteProfile): TasteDifference | null {
  if (you.cuisines.includes("any") || partner.cuisines.includes("any") || overlap(you.cuisines, partner.cuisines).length) return null;
  return {
    topic: "식사",
    you: you.cuisines.map(labelForCuisine).join(", "),
    partner: partner.cuisines.map(labelForCuisine).join(", "),
    bridge: "음식 종류를 한쪽 기준으로 정하지 않았어요. 각자 먹기 편한 메뉴가 있는 곳부터 고르면 좋아요.",
  };
}

function settingBridge(you: TasteProfile, partner: TasteProfile): TasteDifference | null {
  if (you.setting === partner.setting || you.setting === "mix" || partner.setting === "mix") return null;
  return {
    topic: "공간",
    you: labelForSetting(you.setting),
    partner: labelForSetting(partner.setting),
    bridge: "실내에서 한 끼 먹고 바깥을 짧게 걷는 구성이 맞아요.",
  };
}

function crowdBridge(you: TasteProfile, partner: TasteProfile): TasteDifference | null {
  if (you.crowd === partner.crowd || you.crowd === "mix" || partner.crowd === "mix") return null;
  return {
    topic: "분위기",
    you: labelForCrowd(you.crowd),
    partner: labelForCrowd(partner.crowd),
    bridge: "메인 거리는 피하고, 한 블록 안쪽의 조금 한적한 곳을 고르면 둘 다 편해요.",
  };
}

function paceBridge(you: TasteProfile, partner: TasteProfile): TasteDifference | null {
  if (you.pace === partner.pace) return null;
  if ((you.pace === "linger" && partner.pace === "walk") || (you.pace === "walk" && partner.pace === "linger")) {
    const linger = you.pace === "linger" ? "나" : "파트너";
    return {
      topic: "페이스",
      you: labelForPace(you.pace),
      partner: labelForPace(partner.pace),
      bridge: `${linger === "나" ? "식사나 카페에서 여유를 두고" : "상대가 머물고 싶은 곳에서 시간을 둔 뒤"}, 식후에 짧은 산책을 넣으면 걸음과 머무름이 같이 가요.`,
    };
  }
  return {
    topic: "페이스",
    you: labelForPace(you.pace),
    partner: labelForPace(partner.pace),
    bridge: "두세 곳으로 짧게 잇고, 한곳은 오래 앉아도 되는 자리로 고르면 돼요.",
  };
}

function activityBridge(you: TasteProfile, partner: TasteProfile): TasteDifference | null {
  const shared = overlap(you.activities, partner.activities);
  const youOnly = onlyIn(you.activities, partner.activities);
  const partnerOnly = onlyIn(partner.activities, you.activities);
  if (shared.length || (!youOnly.length && !partnerOnly.length)) return null;
  return {
    topic: "하루의 구성",
    you: youOnly.map(labelForActivity).join(", ") || "유연해요",
    partner: partnerOnly.map(labelForActivity).join(", ") || "유연해요",
    bridge: `${[youOnly[0], partnerOnly[0]].filter((activity): activity is DateActivityId => Boolean(activity)).map(labelForActivity).join("과 ")}을 하나씩 담아 보세요.`,
  };
}

function overlapLabels(you: TasteProfile, partner: TasteProfile) {
  const labels = [
    ...overlap(you.areas, partner.areas),
    ...overlap(you.activities, partner.activities).map(labelForActivity),
    ...overlap(you.cuisines, partner.cuisines).filter(item => item !== "any").map(labelForCuisine),
  ];
  if (you.setting === partner.setting || you.setting === "mix" || partner.setting === "mix") {
    const setting = you.setting === "mix" ? partner.setting : you.setting;
    labels.push(labelForSetting(setting));
  }
  if (you.crowd === partner.crowd || you.crowd === "mix" || partner.crowd === "mix") {
    const crowd = you.crowd === "mix" ? partner.crowd : you.crowd;
    labels.push(labelForCrowd(crowd));
  }
  if (you.pace === partner.pace) labels.push(labelForPace(you.pace));
  return [...new Set(labels)].slice(0, 8);
}

function datePrompt(
  you: TasteProfile,
  partner: TasteProfile,
  seed: Omit<TasteDateSeed, "prompt" | "headline" | "lines" | "stayKind">,
  flow: TasteProfile["dateFlow"],
  drink: TasteProfile["drink"],
) {
  const area = seed.areas.join(" · ") || "우리가 고른 동네";
  const acts = seed.activities.map(labelForActivity).join(", ");
  const time = seed.timeWindow === "any" ? "" : `${labelForTime(seed.timeWindow)} `;
  const food = seed.cuisine === "any" ? "" : `${labelForCuisine(seed.cuisine)} `;
  const order = flow === "flex" ? "" : `${labelForDateFlow(flow)} 흐름으로 `;
  const avoid = seed.avoidFoods.length ? ` ${seed.avoidFoods.join(", ")}는 빼줘.` : "";
  const drinkHint = drink === "none" ? " 술자리는 빼줘." : drink === "light" ? " 가벼운 한잔 정도면 괜찮아요." : "";
  const indoor = seed.indoorPlay && seed.indoorPlay !== "상관없음" ? ` 실내는 ${seed.indoorPlay} 쪽.` : "";
  const setting = sharedSetting(you, partner);
  const spaceHint = setting === "indoor" ? " 실내에서 즐길 수 있는 장소 위주로 골라줘."
    : setting === "outdoor" ? " 야외 산책과 풍경을 중심으로, 식사나 휴식 장소를 이어줘."
      : you.setting !== partner.setting && you.setting !== "mix" && partner.setting !== "mix"
        ? " 실내와 야외 선호가 다르니 실내에서 쉬고 야외를 짧게 걷는 구성을 제안해줘."
        : " 실내와 야외 모두 괜찮아요.";
  const crowd = sharedCrowd(you, partner);
  const crowdHint = crowd === "quiet" ? " 북적이는 곳과 오래 줄 서는 곳을 피하고 한적한 곳을 우선해줘."
    : crowd === "lively" ? " 활기 있는 거리 분위기를 좋아해요." : " 거리 분위기는 유연하게 골라줘.";
  const areaChoices = [...new Set([...you.areas, ...partner.areas])];
  const areaHint = areaChoices.length > 1
    ? ` 이번 코스의 기본 동네는 ${area} 한 곳이에요. 다른 동네는 함께 갈 지역을 확인한 뒤 별도 코스로 제안하고, 이 코스에 자동으로 합치지 마세요.` : "";
  const sharedCuisines = overlap(you.cuisines, partner.cuisines).filter(item => item !== "any");
  const cuisineChoices = sharedCuisines.length ? sharedCuisines
    : you.cuisines.includes("any") ? partner.cuisines.filter(item => item !== "any")
      : partner.cuisines.includes("any") ? you.cuisines.filter(item => item !== "any")
        : [...new Set([...you.cuisines, ...partner.cuisines].filter(item => item !== "any"))];
  const cuisineHint = seed.cuisine === "any" && cuisineChoices.length
    ? sharedCuisines.length || you.cuisines.includes("any") || partner.cuisines.includes("any")
      ? ` 식사는 ${cuisineChoices.map(labelForCuisine).join(", ")} 중 고를 수 있게 제안해줘.`
      : ` 식사 취향이 ${cuisineChoices.map(labelForCuisine).join(", ")}으로 다르니 한 종류로 확정하지 말고 각자 먹기 편한 메뉴가 있는 곳을 제안해줘.`
    : "";
  const indoorHint = seed.activities.includes("indoor") && !seed.indoorPlay && you.indoorPlay && partner.indoorPlay
    && you.indoorPlay !== partner.indoorPlay && you.indoorPlay !== "상관없음" && partner.indoorPlay !== "상관없음"
    ? ` 실내 놀이도 ${you.indoorPlay}, ${partner.indoorPlay} 중 함께 할 것을 먼저 확인해줘.` : "";
  const notes = [...new Set([you.note, partner.note].map(item => item.trim()).filter(Boolean))];
  const extra = notes.length ? ` ${notes.join(" / ")}` : "";
  return `${area}에서 ${time}${order}${food}${acts} 데이트. 이동 범위는 ${labelForScope(seed.areaScope)}.${spaceHint}${crowdHint}${areaHint}${cuisineHint}${avoid}${drinkHint}${indoor}${indoorHint}${extra}`.replace(/\s+/g, " ").trim();
}

function seedDisplayLines(you: TasteProfile, partner: TasteProfile, seed: Omit<TasteDateSeed, "prompt" | "headline" | "lines" | "stayKind">) {
  return [
    [seed.areas[0], seed.activities.map(labelForActivity).join(" · "), seed.timeWindow === "any" ? "" : labelForTime(seed.timeWindow)].filter(Boolean).join(" · "),
    [labelForScope(seed.areaScope), labelForSetting(sharedSetting(you, partner)), labelForCrowd(sharedCrowd(you, partner))].join(" · "),
    seed.avoidFoods.length ? `피하기: ${seed.avoidFoods.join(", ")}` : "",
    !overlap(you.areas, partner.areas).length ? "동네가 달라요. 기본 후보를 바꿔도 괜찮아요." : "",
  ].filter(Boolean);
}

function initialTastePrompt(context: string, areas: string[]) {
  return context.length <= 800 ? context
    : `${areas[0] || "함께 고른 동네"}에서 데이트를 추천해줘. 대화에 전달된 두 사람의 저장된 취향과 제외 조건을 모두 반영하고, 서로 다른 조건은 먼저 확인해줘.`;
}

export function seedFromProfile(profile: TasteProfile): TasteDateSeed {
  const cuisine = cuisineSeed(profile, profile);
  const indoorPlay = profile.indoorPlay && profile.indoorPlay !== "상관없음" ? profile.indoorPlay : null;
  const core: Omit<TasteDateSeed, "stayKind" | "prompt" | "headline" | "lines"> = {
    areas: profile.areas.slice(0, 1),
    activities: profile.activities.slice(0, 3),
    cuisine,
    pace: plannerPace(profile.pace),
    timeWindow: profile.timeWindow,
    areaScope: profile.areaScope,
    indoorPlay,
    avoidFoods: profile.avoidFoods,
  };
  const context = datePrompt(profile, profile, core, profile.dateFlow, profile.drink);
  const prompt = initialTastePrompt(context, core.areas);
  return {
    ...core,
    stayKind: "date",
    prompt,
    context,
    headline: core.areas.length ? `${core.areas.join(" · ")}에서 시작하는 하루` : "내 기준으로 짜는 하루",
    lines: seedDisplayLines(profile, profile, core),
  };
}

export function compareTasteProfiles(you: TasteProfile, partner: TasteProfile): TasteCompare {
  const areas = areaSeed(you, partner);
  const activities = activitySeed(you, partner);
  const cuisine = cuisineSeed(you, partner);
  const pace = plannerPace(you.pace === partner.pace ? you.pace : "mixed");
  const timeWindow = timeSeed(you, partner);
  const areaScope = mixScope(you.areaScope, partner.areaScope);
  const dateFlow = flowSeed(you, partner);
  const drink = drinkSeed(you, partner);
  const indoorPlayRaw = indoorSeed(you, partner);
  const indoorPlay = indoorPlayRaw && indoorPlayRaw !== "상관없음" ? indoorPlayRaw : null;
  const avoidFoods = [...new Set([...you.avoidFoods, ...partner.avoidFoods])];
  const differences = [areaBridge(you, partner, areas[0]), cuisineBridge(you, partner), paceBridge(you, partner), activityBridge(you, partner), settingBridge(you, partner), crowdBridge(you, partner)]
    .filter((item): item is TasteDifference => Boolean(item));
  const overlaps = overlapLabels(you, partner);
  const constraints = avoidFoods;
  const core = { areas, activities, cuisine, pace, timeWindow, areaScope, indoorPlay, avoidFoods };
  const context = datePrompt(you, partner, core, dateFlow, drink);
  const prompt = initialTastePrompt(context, areas);
  const headline = areas.length ? `${areas[0]}에서 시작하는 하루` : "함께 고르는 다음 데이트";
  const summary = differences.length
    ? `${overlaps.length ? `${overlaps.slice(0, 3).join(", ")}는 같고, ` : ""}${differences[0].bridge}`
    : `${overlaps.slice(0, 3).join(", ") || "고른 기준"}을 그대로 다음 데이트에 쓰면 돼요.`;
  const seed: TasteDateSeed = {
    ...core,
    stayKind: "date",
    prompt,
    context,
    headline,
    lines: seedDisplayLines(you, partner, core),
  };
  return { headline, summary, overlaps, differences, constraints, datePrompt: prompt, seed };
}

export function applyTasteFallback(state: AIPlannerState, seed: TasteDateSeed): AIPlannerState {
  return {
    ...state,
    areas: state.areas.length ? state.areas : seed.areas,
    regions: state.regions.length ? state.regions : seed.areas,
    region: state.region || seed.areas.join(" · "),
    memorySuggestions: { activities: seed.activities, cuisine: seed.cuisine },
    pace: state.pace === "balanced" && seed.pace !== "balanced" ? seed.pace : state.pace,
  };
}

export function plannerStateFromSeed(seed: TasteDateSeed): AIPlannerState {
  const context = seed.context ?? seed.prompt;
  const contextLines = Array.from({ length: Math.ceil(context.length / 2000) }, (_, index) => context.slice(index * 2000, (index + 1) * 2000));
  return applyTasteFallback({
    ...emptyDateBrief(),
    activities: seed.activities,
    cuisine: seed.cuisine,
    timeWindow: seed.timeWindow,
    areaScope: seed.areaScope,
    indoorPlay: seed.indoorPlay,
    stayKind: seed.stayKind,
    nights: 0,
    conversationNotes: [...contextLines, ...(seed.avoidFoods.length ? [`피하기: ${seed.avoidFoods.join(", ")}`] : [])],
  }, seed);
}

const AVOID_PATTERN: Record<string, RegExp> = {
  "매운 음식": /매운|불닭|엽기|짬뽕|마라|고추/,
  해산물: /해산물|조개|홍합|꽃게|대하|오징어|낙지|문어/,
  회: /회집|횟집|활어|사시미|모둠회|\b회\b/,
  내장: /곱창|막창|대창|내장|순대/,
  양고기: /양고기|양꼬치|양갈비/,
  고깃집: /고깃집|삼겹|갈비|한우|고기구이/,
  "줄 서는 맛집": /웨이팅|줄서/,
  술: /포차|호프|술집|이자카야|맥주|소주|막걸리/,
};

export function violatesTasteAvoid(blob: string, avoids: string[]) {
  const hay = blob.replace(/\s+/g, "");
  return avoids.some(avoid => {
    const pattern = AVOID_PATTERN[avoid];
    if (pattern) return pattern.test(blob) || pattern.test(hay);
    const needle = avoid.replace(/\s+/g, "");
    return needle.length >= 2 && hay.includes(needle);
  });
}

export function applyTasteHarshAllow<T extends { hoe: boolean; meat: boolean; bar: boolean }>(
  allow: T,
  message: string,
  avoids: string[],
): T {
  const askedHoe = /회집|횟집|회\s*먹|활어|사시미/.test(message);
  const askedMeat = /고깃집|삼겹|곱창|갈비|한우|고기\s*먹/.test(message);
  const askedBar = /포차|호프|술집|맥주|소주|막걸리|이자카야/.test(message);
  return {
    ...allow,
    hoe: askedHoe ? allow.hoe : allow.hoe && !avoids.some(item => item === "회" || item === "해산물"),
    meat: askedMeat ? allow.meat : allow.meat && !avoids.some(item => item === "고깃집" || item === "내장"),
    bar: askedBar ? allow.bar : allow.bar && !avoids.includes("술"),
  };
}

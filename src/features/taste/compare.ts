import { emptyDateBrief } from "@/features/ai/dateBrief";
import type { AIPlannerState, DateActivityId, DateAreaScope, DateCuisineChoice } from "@/features/planning/types/plan";
import {
  labelForActivity,
  labelForBudget,
  labelForCrowd,
  labelForCuisine,
  labelForDateFlow,
  labelForDrink,
  labelForPace,
  labelForSetting,
  labelForTime,
} from "./options";
import type { TasteBudget, TasteCompare, TasteDateSeed, TasteDifference, TasteProfile } from "./types";

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

function quieterBudget(left: TasteBudget, right: TasteBudget): TasteBudget {
  const rank: Record<TasteBudget, number> = { modest: 0, comfortable: 1, generous: 2 };
  return rank[left] <= rank[right] ? left : right;
}

function mixScope(left: DateAreaScope, right: DateAreaScope): DateAreaScope {
  if (left === right) return left;
  if (left === "core" || right === "core") return "walkable";
  return "nearby";
}

function cuisineSeed(you: TasteProfile, partner: TasteProfile): DateCuisineChoice {
  const shared = overlap(you.cuisines, partner.cuisines).filter(item => item !== "any");
  if (shared.length === 1) return shared[0];
  if (shared.length > 1) return "any";
  const any = you.cuisines.includes("any") || partner.cuisines.includes("any");
  return any ? "any" : you.cuisines[0] === "any" ? "any" : you.cuisines[0];
}

function activitySeed(you: TasteProfile, partner: TasteProfile): DateActivityId[] {
  const shared = overlap(you.activities, partner.activities);
  if (shared.length) return shared.slice(0, 3);
  return [...new Set([...you.activities.slice(0, 2), ...partner.activities.slice(0, 1)])].slice(0, 3);
}

function areaSeed(you: TasteProfile, partner: TasteProfile) {
  const shared = overlap(you.areas, partner.areas);
  if (shared.length) return shared.slice(0, 2);
  return [...new Set([you.areas[0], partner.areas[0]].filter(Boolean))].slice(0, 2);
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
  return you.indoorPlay || partner.indoorPlay || "상관없음";
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
    bridge: `${[...youOnly, ...partnerOnly].slice(0, 2).map(labelForActivity).join(" 다음에 ")} 순서로 이어 보세요.`,
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
  const notes = [you.note, partner.note].map(item => item.trim()).filter(Boolean);
  const extra = notes.length ? ` ${notes.join(" / ")}` : "";
  return `${area}에서 ${time}${order}${food}${acts} 데이트.${avoid}${drinkHint}${indoor}${extra}`.replace(/\s+/g, " ").trim();
}

export function seedFromProfile(profile: TasteProfile): TasteDateSeed {
  const picked = profile.cuisines.find(item => item !== "any");
  const cuisine: DateCuisineChoice = picked ?? "any";
  const indoorPlay = profile.indoorPlay && profile.indoorPlay !== "상관없음" ? profile.indoorPlay : null;
  const core: Omit<TasteDateSeed, "stayKind" | "prompt" | "headline" | "lines"> = {
    areas: profile.areas.slice(0, 2),
    activities: profile.activities.slice(0, 3),
    cuisine,
    pace: plannerPace(profile.pace),
    timeWindow: profile.timeWindow,
    areaScope: profile.areaScope,
    indoorPlay,
    avoidFoods: profile.avoidFoods,
  };
  const prompt = datePrompt(profile, profile, core, profile.dateFlow, profile.drink);
  return {
    ...core,
    stayKind: "date",
    prompt,
    headline: core.areas.length ? `${core.areas.join(" · ")}에서 시작하는 하루` : "내 기준으로 짜는 하루",
    lines: [prompt, profile.note].filter(Boolean),
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
  const differences = [paceBridge(you, partner), activityBridge(you, partner), settingBridge(you, partner), crowdBridge(you, partner)]
    .filter((item): item is TasteDifference => Boolean(item));
  const overlaps = overlapLabels(you, partner);
  const constraints = avoidFoods;
  const budget = quieterBudget(you.budget, partner.budget);
  const core = { areas, activities, cuisine, pace, timeWindow, areaScope, indoorPlay, avoidFoods };
  const prompt = datePrompt(you, partner, core, dateFlow, drink);
  const headline = overlaps.length
    ? `${overlaps.slice(0, 2).join(" · ")}에서 시작하는 하루`
    : "차이를 한 코스로 잇는 하루";
  const summary = differences.length
    ? `${overlaps.length ? `${overlaps.slice(0, 3).join(", ")}는 같고, ` : ""}${differences[0].bridge}`
    : `${overlaps.slice(0, 3).join(", ") || "고른 기준"}을 그대로 다음 데이트에 쓰면 돼요.`;
  const seed: TasteDateSeed = {
    ...core,
    stayKind: "date",
    prompt,
    headline,
    lines: [
      prompt,
      budget === "modest" ? "예산은 부담 없는 쪽으로 맞춰요." : "",
      constraints.length ? `${constraints.join(", ")}는 빼요.` : "",
    ].filter(Boolean),
  };
  return { headline, summary, overlaps, differences, constraints, datePrompt: prompt, seed };
}

export function applyTasteFallback(state: AIPlannerState, seed: TasteDateSeed): AIPlannerState {
  return {
    ...state,
    areas: state.areas.length ? state.areas : seed.areas,
    regions: state.regions.length ? state.regions : seed.areas,
    region: state.region || seed.areas.join(" · "),
    activities: state.intakeFocusDone ? state.activities : state.activities.length ? state.activities : seed.activities,
    cuisine: state.cuisine ?? seed.cuisine,
    timeWindow: state.timeWindow ?? seed.timeWindow,
    areaScope: state.areaScope ?? seed.areaScope,
    indoorPlay: state.indoorPlay ?? seed.indoorPlay,
    pace: state.pace === "balanced" && seed.pace !== "balanced" ? seed.pace : state.pace,
  };
}

export function plannerStateFromSeed(seed: TasteDateSeed): AIPlannerState {
  return applyTasteFallback({
    ...emptyDateBrief(),
    stayKind: seed.stayKind,
    nights: 0,
    conversationNotes: seed.avoidFoods.length ? [`피하기: ${seed.avoidFoods.join(", ")}`] : [],
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

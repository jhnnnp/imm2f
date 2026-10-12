import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyDateBrief, withAreas } from "@/features/ai/dateBrief";
import * as client from "./client";
import { routeDateChat } from "./routeDateChat";
import { interpretDateRequest } from "./interpretDateRequest";
import { answerDateQuestion } from "./answerDateQuestion";

// Opt-in only. Credentials stay in memory and are never included in assertions
// or test output. Controlled venue facts test reasoning without external facts.
if (process.env.LIVE_OPENAI === "1") {
  for (const path of [".env", ".env.local"]) {
    try {
      for (const line of readFileSync(path, "utf8").split("\n")) {
        const match = line.trim().match(/^([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
        if (match && (path.endsWith(".local") || !(match[1] in process.env))) {
          process.env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
        }
      }
    } catch { /* optional local credentials */ }
  }
}
const live = process.env.LIVE_OPENAI === "1" && Boolean(process.env.OPENAI_API_KEY);
const state = { ...withAreas(emptyDateBrief(), ["성수"]), stayKind: "date" as const };

beforeEach(() => { vi.spyOn(client, "completeJson"); });
afterEach(() => vi.restoreAllMocks());

async function successfulGeneration(schemaName: string) {
  const spy = vi.mocked(client.completeJson);
  const index = spy.mock.calls.findIndex(([request]) => request.jsonSchema?.name === schemaName);
  expect(index, `provider call for ${schemaName}`).toBeGreaterThanOrEqual(0);
  const value = await spy.mock.results[index].value;
  expect(value, `successful provider response for ${schemaName}`).not.toBeNull();
  return { value: value as Record<string, unknown>, request: spy.mock.calls[index][0] };
}

describe("contextual date conversation reasoning (live)", () => {
  it.skipIf(!live)("understands an implicit conversation-focused date rather than imposing an activity template", async () => {
    const message = "사람 덜 붐비고 이야기 오래할 수 있는 데이트를 준비해줘";
    const route = await routeDateChat({ message, state, hasCourse: false, currentCourse: [],
      conversation: [{ role: "user", text: "이번에는 성수에서 오랜만에 만나려고 해" }] });
    expect(route.mode).toBe("course");
    await successfulGeneration("date_chat_route_v2");
    const interpreted = await interpretDateRequest({ message, previousState: state, previousPlaceNames: [] });
    await successfulGeneration("date_intent_patch_v1");
    expect(interpreted.state.areas).toEqual(["성수"]);
    expect(interpreted.state.preferences?.crowdTolerance).toBeLessThan(0.5);
    expect(interpreted.state.preferences?.intimacy).toBeGreaterThan(0.5);
    expect(interpreted.state.activities).toEqual([]);
  }, 65000);

  it.skipIf(!live)("interprets a nuanced mood correction while retaining an unrelated photo preference", async () => {
    const previous = { ...state, preferences: { vibe: ["조용한", "사진 찍기 좋은"], crowdTolerance: 0.2 },
      inferredPreferences: [{ value: "사진을 남길 만한 공간 선호", evidence: "사진 찍", confidence: 0.8 }] };
    const message = "시끄러운 건 싫지만 조용하기만 한 곳은 재미없어. 같이 해볼 만한 색다른 경험도 있는 데이트로 바꿔줘";
    const result = await interpretDateRequest({ message, previousState: previous, previousPlaceNames: [] });
    await successfulGeneration("date_intent_patch_v1");
    expect(result.state.preferences?.novelty).toBeGreaterThan(0.5);
    expect(result.state.preferences?.vibe).toContain("사진 찍기 좋은");
    expect(result.state.inferredPreferences?.some(item => item.value.includes("사진"))).toBe(true);
    expect(result.state.inferredPreferences?.every(item => item.value.includes("사진") || message.includes(item.evidence))).toBe(true);
  }, 40000);

  it.skipIf(!live)("drops the final active photo mood after an explicit correction instead of restoring stale state", async () => {
    const oldPhoto = { value: "사진을 남길 만한 공간 선호", evidence: "사진 찍", confidence: 0.8 };
    const result = await interpretDateRequest({ message: "사진찍기 이제 싫어",
      previousState: { ...state, preferences: { vibe: ["사진 찍기 좋은"] }, inferredPreferences: [oldPhoto] },
      previousPlaceNames: [] });
    await successfulGeneration("date_intent_patch_v1");
    expect(result.state.preferences?.vibe).toEqual([]);
    expect(result.state.inferredPreferences).not.toContainEqual(oldPhoto);
    expect(result.state.areas).toEqual(["성수"]);
  }, 40000);

  it.skipIf(!live)("explains the assistant-named venue and compares actual supplied evidence without inventing venue facts", async () => {
    const stops = [
      { name: "검증 대화 카페", meta: "카페", reason: "분리된 좌석과 작은 정원이 있어 대화 목적에 맞는 후보예요." },
      { name: "검증 공연 카페", meta: "카페", reason: "큰 음악과 DJ 공연이 있어 활기찬 경험을 원하는 분께 맞는 후보예요." },
    ];
    const input = { state: { ...state, objective: "오랜만에 만나 오래 대화하는 데이트", preferences: { vibe: ["대화하기 좋은"] } },
      stops, coupleTaste: { summary: "", commonTastes: [], avoidFoods: [] },
      conversation: [{ role: "assistant" as const, text: "대화 목적을 고려해서 검증 대화 카페를 먼저 추천드려요." }] };
    const why = await answerDateQuestion({ ...input, message: "그 카페를 왜 추천했어?" });
    const generation = await successfulGeneration("date_question_reply_v2");
    const payload = JSON.parse(generation.request.messages[1].content);
    expect(payload.focusStops.map((stop: { name: string }) => stop.name)).toEqual([stops[0].name]);
    expect(why.lines.join(" ").length).toBeGreaterThan(30);
    expect(why.lines.join(" ")).not.toMatch(/\d[,.]\d점|무료\s*주차|예약\s*완료/);
    const compared = await answerDateQuestion({ ...input, message: "1번과 2번 중 우리처럼 오래 대화하고 싶은 사람에게 어느 곳이 더 맞아?" });
    const latest = vi.mocked(client.completeJson).mock.results.at(-1)!;
    expect(await latest.value).not.toBeNull();
    expect(compared.lines.join(" ")).toContain("검증 대화 카페");
    expect(compared.lines.join(" ")).not.toMatch(/\d[,.]\d점|무료\s*주차|예약\s*완료/);
  }, 65000);
});

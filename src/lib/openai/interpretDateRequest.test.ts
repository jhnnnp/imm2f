import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyDateBrief, missingSlot } from "@/features/ai/dateBrief";
import { applyInterpretPatch, dateIntentPayloadSchema, fallbackPatch, interpretDateRequest, mergeDateState, shouldSkipDateNlu, shouldUseLocalInterpret, validateIntentPayload } from "./interpretDateRequest";
import { completeJson } from "./client";

vi.mock("./client", () => ({ completeJson: vi.fn() }));
vi.mock("./datePlaybook", () => ({ retrieveDatePlaybook: vi.fn(async () => []) }));
afterEach(() => { vi.unstubAllEnvs(); vi.mocked(completeJson).mockReset(); });

describe("interpretDateRequest local merge", () => {
  it("clears legacy budget state and never extracts a new monetary limit", () => {
    const previous = { ...emptyDateBrief(), areas: ["부산"], budgetWon: 50000 };
    const next = applyInterpretPatch({ message: "부산 2박3일 하루 예산 10만원", previousState: previous,
      patch: fallbackPatch("부산 2박3일 하루 예산 10만원") }).state;
    expect(next.budgetWon).toBeNull();
    expect(mergeDateState(previous, { intent: "reset" }).budgetWon).toBeNull();
    expect(dateIntentPayloadSchema.required).not.toContain("budgetWon");
    expect(dateIntentPayloadSchema.required).not.toContain("dailyBudgetWon");
    expect(validateIntentPayload({ budgetWon: 100000, addAreas: ["부산"] })).toEqual({ addAreas: ["부산"] });
  });

  it("keeps prior clocks and date when a follow-up refers to a performance clock", () => {
    const previous = { ...emptyDateBrief(), areas: ["성수"], startTime: "10:00", endTime: "21:00", dateLabel: "2026-10-20", timeWindow: "any" as const };
    const result = applyInterpretPatch({ message: "공연은 19:00이고 야경도 넣어줘", previousState: previous,
      patch: { startTime: "19:00", endTime: "23:00", intent: "modify" } });
    expect(result.state).toMatchObject({ startTime: "10:00", endTime: "21:00", dateLabel: "2026-10-20" });
    const period = applyInterpretPatch({ message: "공연은 오후 7시이고 야경도 넣어줘", previousState: previous,
      patch: { startTime: "19:00", endTime: "23:00", timeWindow: "evening", intent: "modify" } }).state;
    expect(period).toMatchObject({ startTime: "10:00", endTime: "21:00", timeWindow: "any" });
  });

  it("updates only the explicitly changed start time or calendar date across model defaults", () => {
    const previous = { ...emptyDateBrief(), areas: ["성수"], startTime: "14:00", endTime: "21:00", dateLabel: "2026-10-17", timeWindow: "any" as const };
    const timed = applyInterpretPatch({ message: "시작 시간을 16:30로 바꿔줘", previousState: previous,
      patch: { startTime: "09:00", endTime: "23:00", intent: "modify" } }).state;
    expect(timed).toMatchObject({ startTime: "16:30", endTime: "21:00", dateLabel: "2026-10-17" });
    const dated = applyInterpretPatch({ message: "2027-02-20으로 날짜 바꿔줘", previousState: timed,
      patch: { startTime: "09:00", endTime: "23:00", intent: "modify" } }).state;
    expect(dated).toMatchObject({ startTime: "16:30", endTime: "21:00", dateLabel: "2027-02-20" });
    const meeting = applyInterpretPatch({ message: "오후 3시에 만나자", previousState: { ...previous, endTime: "20:00", timeWindow: "evening" },
      patch: { startTime: "09:00", endTime: "23:00", intent: "modify" } }).state;
    expect(meeting).toMatchObject({ startTime: "15:00", endTime: "20:00", timeWindow: "any" });
  });

  it("releases the old city venues even when the model incorrectly retains them", () => {
    const previous = { ...emptyDateBrief(), areas: ["부산"], requiredPlaces: ["태종대 전망대"], pinOrder: ["태종대 전망대"],
      excludedFoods: ["새우"], foodAllergy: true, budgetWon: 100000 };
    const result = applyInterpretPatch({ message: "부산 말고 제주로 변경해줘", previousState: previous,
      patch: { addAreas: ["부산", "제주"], intent: "modify", preserveExistingPlaces: true } }).state;
    expect(result.areas).toEqual(["제주"]);
    expect(result.requiredPlaces).toEqual([]);
    expect(result.pinOrder).toEqual([]);
    expect(result.preserveExistingPlaces).toBe(false);
    expect(result.excludedFoods).toEqual(["새우"]);
    expect(result.budgetWon).toBeNull();
  });
  it("rejects an area invented from the user's colloquial verb", () => {
    const result = applyInterpretPatch({ message: "부산 여행가려구",
      patch: { addAreas: ["부산", "여행가려구"], intent: "create" } });
    expect(result.state.areas).toEqual(["부산"]);
  });
  it("does not let a model turn an unspecified trip into a day trip", () => {
    const result = applyInterpretPatch({ message: "부산 여행가려구",
      patch: { addAreas: ["부산"], stayKind: "daytrip", nights: 0, intent: "create" } });
    expect(result.state.areas).toEqual(["부산"]);
    expect(result.state.stayKind).toBeNull();
    expect(result.slot).toBe("span");
  });
  it("retains preferences when replacing the course, but releases the old venue pins", () => {
    const previous = { ...emptyDateBrief(), areas: ["왕십리"], cuisine: "일식" as const, activities: ["meal", "cafe"] as const, timeWindow: "evening" as const, requiredPlaces: ["식당 A"], pinOrder: ["식당 A"], budgetWon: 70000 };
    const next = mergeDateState({ ...previous, activities: [...previous.activities] }, { intent: "create", preserveExistingPlaces: false });
    expect(next.cuisine).toBe("일식");
    expect(next.activities).toEqual(["meal", "cafe"]);
    expect(next.timeWindow).toBe("evening");
    expect(next.budgetWon).toBeNull();
    expect(next.requiredPlaces).toEqual([]);
    expect(next.pinOrder).toEqual([]);
  });

  it.each([{ addAreas: "성수" }, { addPlaces: [null] }, { indoorPlay: {} }, { preserveExistingPlaces: "false" }, { nights: "2" }])("rejects malformed intent data %j", value => {
    expect(validateIntentPayload(value)).toBeNull();
  });

  it("ignores null optional fields without erasing prior constraints", () => {
    expect(validateIntentPayload({ addAreas: [" 성수 "], cuisine: null, preserveExistingPlaces: true })).toEqual({ addAreas: ["성수"], preserveExistingPlaces: true });
  });
  it("keeps the model's trip intent separate from an explicit stay length", () => {
    expect(validateIntentPayload({ journeyType: "trip", stayKind: null })).toEqual({ journeyType: "trip" });
    expect(validateIntentPayload({ journeyType: "holiday" })).toBeNull();
    const result = applyInterpretPatch({ message: "부산에서 며칠 쉬고 싶어",
      patch: { journeyType: "trip", addAreas: ["부산"], intent: "create" } });
    expect(result.journeyType).toBe("trip");
    expect(result.state.stayKind).toBeNull();
  });
  it("does not store the JSON schema's objective placeholder", () => {
    expect(validateIntentPayload({ objective: "short Korean date goal" })).toEqual({});
  });
  it("skips NLU only for greetings, not for named destinations", () => {
    expect(shouldSkipDateNlu("안녕하세요")).toBe(true);
    expect(shouldSkipDateNlu("성수에서 데이트하고 싶어")).toBe(false);
    expect(shouldSkipDateNlu("판교 여행 코스 짜줘")).toBe(false);
    expect(shouldSkipDateNlu("을지로에서 뭘 해")).toBe(false);
    expect(shouldSkipDateNlu("맛집 소개해줘")).toBe(false);
    expect(shouldSkipDateNlu("뭐 할 수 있어")).toBe(true);
    expect(shouldSkipDateNlu("너는 누구야")).toBe(true);
    expect(shouldUseLocalInterpret("성수에서 데이트하고 싶어")).toBe(false);
    expect(shouldUseLocalInterpret("포천 여행 짜줘")).toBe(false);
    expect(shouldUseLocalInterpret("포천 산정호수 가고싶어")).toBe(false);
    expect(shouldUseLocalInterpret("추가해줘", emptyDateBrief())).toBe(false);
    expect(shouldUseLocalInterpret("한 곳 더 추가해줘", emptyDateBrief())).toBe(false);
    expect(shouldUseLocalInterpret("일정추가", emptyDateBrief())).toBe(false);
    expect(shouldUseLocalInterpret("밥 먹을 데도 있으면 좋겠어", emptyDateBrief())).toBe(false);
  });

  it("does not lock a mix on a destination-only message", () => {
    const local = fallbackPatch("성수에서 데이트하고 싶어");
    const merged = mergeDateState(undefined, local);
    expect(merged.areas).toContain("성수");
    expect(merged.activities).toEqual([]);
    expect(merged.stayKind).toBe("date");
    expect(missingSlot(merged)).toBeNull();
  });

  it("ignores guessed mixes and keeps named activities", () => {
    const mix = applyInterpretPatch({
      message: "성수에서 데이트하고 싶어",
      patch: { addAreas: ["성수"], addActivities: ["cafe", "walk", "exhibit"], stayKind: "date", intent: "create" },
    });
    expect(mix.state.activities).toEqual([]);
    const cafeOnly = applyInterpretPatch({
      message: "성수에서 데이트하고 싶어",
      patch: { addAreas: ["성수"], addActivities: ["cafe"], stayKind: "date", intent: "create" },
    });
    expect(cafeOnly.state.activities).toEqual([]);
    const tourismMix = applyInterpretPatch({
      message: "성수에서 데이트하고 싶어",
      patch: { addAreas: ["성수"], addActivities: ["meal", "walk", "exhibit"], stayKind: "date", intent: "create" },
    });
    expect(tourismMix.state.activities).toEqual([]);
  });

  it("does not turn an open dinner request into a model-guessed cuisine", () => {
    const result = applyInterpretPatch({
      message: "왕십리에서 저녁 먹고 예쁜 카페와 공연을 보고 싶어",
      patch: { addAreas: ["왕십리"], addActivities: ["meal", "cafe"], cuisine: "한식", intent: "create" },
    });
    expect(result.state.cuisine).toBeNull();
    expect(result.state.activities).toEqual(expect.arrayContaining(["meal", "cafe", "performance"]));
  });

  it("keeps LLM activities instead of unioning regex false positives", () => {
    const result = applyInterpretPatch({
      message: "성수에서 전시 보고 싶어",
      patch: { addAreas: ["성수"], addActivities: ["exhibit"], intent: "create" },
    });
    expect(result.state.activities).toEqual(["exhibit"]);
    expect(result.state.areas).toContain("성수");
  });

  it("asks for an area when the user wants a date with no place", () => {
    const result = applyInterpretPatch({
      message: "데이트하고 싶어",
      patch: fallbackPatch("데이트하고 싶어"),
    });
    expect(result.slot).toBe("area");
    expect(result.state.areas).toEqual([]);
    expect(result.state.stayKind).toBe("date");
  });

  it("reads overnight length from 1박2일 and does not ask the time slot", () => {
    const result = applyInterpretPatch({
      message: "군산에 여행가면서 놀고싶어 1박2일 일정으로",
      patch: fallbackPatch("군산에 여행가면서 놀고싶어 1박2일 일정으로"),
    });
    expect(result.state.areas).toContain("군산");
    expect(result.state.stayKind).toBe("overnight");
    expect(result.state.nights).toBe(1);
    expect(result.slot).toBeNull();
  });

  it("treats 성수 갈래 as a neighborhood date and does not ask stay length", () => {
    const result = applyInterpretPatch({
      message: "성수 갈래",
      patch: fallbackPatch("성수 갈래"),
    });
    expect(result.state.areas).toContain("성수");
    expect(result.state.stayKind).toBe("date");
    expect(result.slot).toBeNull();
  });

  it("keeps the user's follow-up wording and flags an extra stop for the judge", () => {
    const previous = applyInterpretPatch({
      message: "왕십리 데이트",
      patch: fallbackPatch("왕십리 데이트"),
    }).state;
    const typed = applyInterpretPatch({
      message: "밥 먹을 데도 있으면 좋겠어",
      previousState: previous,
      patch: {
        intent: "modify",
        preserveExistingPlaces: true,
        addStop: true,
        conversationNote: "밥 먹을 데도 있으면 좋겠어",
      },
    });
    expect(shouldUseLocalInterpret("밥 먹을 데도 있으면 좋겠어", previous)).toBe(false);
    expect(typed.state.addStop).toBe(true);
    expect(typed.state.preserveExistingPlaces).toBe(true);
    expect(typed.state.conversationNotes.at(-1)).toBe("밥 먹을 데도 있으면 좋겠어");
    const chip = applyInterpretPatch({
      message: "일정추가",
      previousState: previous,
      patch: fallbackPatch("일정추가"),
    });
    expect(chip.state.addStop).toBe(true);
    expect(chip.state.conversationNotes.at(-1)).toBe("일정추가");
    expect(fallbackPatch("추가해줘").addStop).toBe(true);
    expect(fallbackPatch("추가해줘").conversationNote).toBe("추가해줘");
    expect(fallbackPatch("조금 다르게").preserveExistingPlaces).toBe(false);
  });

  it.each([{ intent: "guess" }, { cuisine: "Italian" }, { areaScope: "city" },
    { stayKind: "holiday" }, { timeWindow: "morning" }, { pace: "fast" }, { askSlot: "scope" },
    { startTime: "24:00" }, { endTime: "18:75" }, { nights: 1.5 }, { nights: -1 }, { nights: 15 }])
  ("rejects malformed enum, clock or span data %j", value => {
    expect(validateIntentPayload(value)).toBeNull();
  });

  it("uses the exact user stay length even when the model proposes another duration", () => {
    const result = applyInterpretPatch({ message: "부산 2박 3일 여행 코스 짜줘",
      patch: { addAreas: ["부산"], stayKind: "date", nights: 0, intent: "create" } });
    expect(result.state.stayKind).toBe("overnight");
    expect(result.state.nights).toBe(2);
  });

  it("preserves a supported parsed duration without silently reducing it to six nights", () => {
    const result = applyInterpretPatch({ message: "부산에서 7박8일 여행",
      patch: fallbackPatch("부산에서 7박8일 여행") });
    expect(result.state.nights).toBe(7);
  });

  it("preserves all venue constraints and pins in a follow-up", () => {
    const requiredPlaces = Array.from({ length: 20 }, (_, index) => `장소 ${index + 1}`);
    const excludedPlaces = Array.from({ length: 15 }, (_, index) => `제외 장소 ${index + 1}`);
    const previous = { ...emptyDateBrief(), requiredPlaces, excludedPlaces, pinOrder: requiredPlaces };
    const next = mergeDateState(previous, { intent: "modify", preserveExistingPlaces: true });
    expect(next.requiredPlaces).toEqual(requiredPlaces);
    expect(next.excludedPlaces).toEqual(excludedPlaces);
    expect(next.pinOrder).toEqual(requiredPlaces);
    expect(validateIntentPayload({ addPlaces: requiredPlaces })?.addPlaces).toEqual(requiredPlaces);
  });

  it("does not erase an earlier mood when structured output has no new mood", () => {
    const previous = { ...emptyDateBrief(), preferences: { vibe: ["조용한", "사진 찍기 좋은"], crowdTolerance: 0.2 } };
    const next = mergeDateState(previous, { preferences: { vibe: [] }, intent: "modify" });
    expect(next.preferences?.vibe).toEqual(previous.preferences.vibe);
    expect(next.preferences?.crowdTolerance).toBe(0.2);
  });

  it("retains prior grounded soft cues when a follow-up has no new inferred preference", () => {
    const previous = { ...emptyDateBrief(), inferredPreferences: [
      { value: "사진을 남길 만한 공간 선호", evidence: "사진 찍", confidence: 0.8 },
    ] };
    const next = mergeDateState(previous, { inferredPreferences: [], intent: "modify" });
    expect(next.inferredPreferences).toEqual(previous.inferredPreferences);
  });

  it("removes the final active photo mood when the user rejects it, including on local fallback", () => {
    const photo = { value: "사진을 남길 만한 공간 선호", evidence: "사진 찍", confidence: 0.8 };
    const previous = { ...emptyDateBrief(), preferences: { vibe: ["사진 찍기 좋은"] }, inferredPreferences: [photo] };
    const message = "사진찍기 이제 싫어";
    const result = applyInterpretPatch({ message, previousState: previous,
      patch: { intent: "modify", preferences: { vibe: [] }, removeInferredPreferences: [photo.value],
        removePreferenceVibes: ["사진 찍기 좋은"] } });
    expect(result.state.preferences?.vibe).toEqual([]);
    expect(result.state.inferredPreferences).toEqual([]);
    const fallback = applyInterpretPatch({ message, previousState: previous, patch: fallbackPatch(message) });
    expect(fallback.state.preferences?.vibe).toEqual([]);
    expect(fallback.state.inferredPreferences).toEqual([]);
  });

  it("keeps unrelated moods while explicitly clearing just one prior mood", () => {
    const previous = { ...emptyDateBrief(), preferences: { vibe: ["사진 찍기 좋은", "조용한"] } };
    const next = mergeDateState(previous, { preferences: { vibe: [] }, removePreferenceVibes: ["사진 찍기 좋은"] });
    expect(next.preferences?.vibe).toEqual(["조용한"]);
    expect(mergeDateState(previous, { preferences: { vibe: [] }, removePreferenceVibes: [] }).preferences?.vibe)
      .toEqual(previous.preferences.vibe);
  });

  it("allows a semantic correction to clear the last mood without clearing new unrelated moods", () => {
    const previous = { ...emptyDateBrief(), preferences: { vibe: ["고급스러운"] } };
    const cleared = mergeDateState(previous, { preferences: { vibe: [] }, removePreferenceVibes: ["고급스러운"] });
    expect(cleared.preferences?.vibe).toEqual([]);
    const changed = mergeDateState(previous, { preferences: { vibe: ["고급스러운", "편안한"] }, removePreferenceVibes: ["고급스러운"] });
    expect(changed.preferences?.vibe).toEqual(["편안한"]);
  });

  it("replaces only an explicitly superseded soft cue while keeping unrelated conversation preferences", () => {
    const oldQuiet = { value: "붐비지 않고 대화하기 좋은 장소 선호", evidence: "조용한", confidence: 0.8 };
    const oldPhoto = { value: "사진을 남길 만한 공간 선호", evidence: "사진 찍", confidence: 0.8 };
    const next = applyInterpretPatch({ message: "조용한 곳 말고 활기찬 곳으로 해줘",
      previousState: { ...emptyDateBrief(), inferredPreferences: [oldQuiet, oldPhoto], preferences: { vibe: ["조용한", "사진 찍기 좋은"], crowdTolerance: 0.2 } },
      patch: { intent: "modify", preferences: { vibe: ["활기찬", "사진 찍기 좋은"], crowdTolerance: 0.8 },
        removeInferredPreferences: [oldQuiet.value],
        inferredPreferences: [{ value: "활기찬 분위기 선호", evidence: "활기찬", confidence: 0.9 }] } });
    expect(next.state.preferences?.crowdTolerance).toBe(0.8);
    expect(next.state.preferences?.vibe).not.toContain("조용한");
    expect(next.state.inferredPreferences).toContainEqual(oldPhoto);
    expect(next.state.inferredPreferences).not.toContainEqual(oldQuiet);
  });

  it.each(["성수에서 조용한 곳 말고 활기찬 곳으로 해줘", "성수에서 조용하지 않아도 괜찮아",
    "성수에서 사진 찍기 싫어", "시끄러운 건 싫지만 조용하기만 한 곳은 재미없어"])
  ("does not promote a negated local cue into a positive preference: %s", message => {
    const result = applyInterpretPatch({ message, patch: { intent: "create", preferences: { vibe: ["활기찬"], crowdTolerance: 0.8 } } });
    expect(result.state.preferences?.crowdTolerance).toBe(0.8);
    expect(result.state.preferences?.vibe).not.toContain("조용한");
    expect(result.state.preferences?.vibe).not.toContain("사진 찍기 좋은");
  });

  it("rejects malformed inferred preference rows before merging model data", () => {
    expect(validateIntentPayload({ inferredPreferences: [{ value: "quiet", evidence: "조용한", confidence: "high" }] })).toBeNull();
    expect(validateIntentPayload({ inferredPreferences: [null] })).toBeNull();
  });

  it("keeps an explicit quiet preference despite contradictory inferred model fields", () => {
    const result = applyInterpretPatch({ message: "성수에서 조용히 대화하고 싶어",
      patch: { addAreas: ["성수"], preferences: { vibe: [], crowdTolerance: 0.9 }, intent: "create" } });
    expect(result.state.preferences?.vibe).toContain("조용한");
    expect(result.state.preferences?.crowdTolerance).toBe(0.2);
  });

  it("does not turn a night-view stop into a night-only trip or an invented narrow radius", () => {
    const previous = { ...emptyDateBrief(), startTime: "10:00", endTime: "21:00", timeWindow: "any" as const };
    const result = applyInterpretPatch({ message: "부산 2박3일 여행에 야경도 넣어줘", previousState: previous,
      patch: { addAreas: ["부산"], timeWindow: "night", startTime: "20:00", endTime: "23:00",
        areaScope: "core", intent: "modify" } });
    expect(result.state.timeWindow).toBe("any");
    expect(result.state.startTime).toBe("10:00");
    expect(result.state.endTime).toBe("21:00");
    expect(result.state.areaScope).toBeNull();
  });

  it("keeps dietary safety constraints when the user rebuilds the course", () => {
    const previous = { ...emptyDateBrief(), areas: ["부산"], excludedFoods: ["새우", "해산물"], foodAllergy: true };
    const result = applyInterpretPatch({ message: "코스를 처음부터 다시 짜줘", previousState: previous,
      patch: { intent: "reset", preserveExistingPlaces: false, preferences: { vibe: [] } } });
    expect(result.state.excludedFoods).toEqual(["새우", "해산물"]);
    expect(result.state.foodAllergy).toBe(true);
  });

  it("sends a strict complete intent schema, including removePlaces, to the provider", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.mocked(completeJson).mockResolvedValue({ addAreas: ["부산"], intent: "create", preferences: { vibe: [] } });
    const result = await interpretDateRequest({ message: "부산 2박3일 여행", previousPlaceNames: [] });
    expect(result.state.nights).toBe(2);
    const request = vi.mocked(completeJson).mock.calls[0][0];
    expect(request.jsonSchema).toEqual({ name: "date_intent_patch_v1", strict: true, schema: dateIntentPayloadSchema });
    const checkObject = (node: Record<string, unknown>) => {
      if (node.type === "object") {
        expect(node.additionalProperties).toBe(false);
        expect(node.required).toEqual(Object.keys(node.properties as object));
      }
      for (const value of Object.values(node)) {
        if (value && typeof value === "object" && !Array.isArray(value)) checkObject(value as Record<string, unknown>);
      }
    };
    checkObject(dateIntentPayloadSchema);
    expect(dateIntentPayloadSchema.required).toContain("removePlaces");
  });
});

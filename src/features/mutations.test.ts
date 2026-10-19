import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createServiceClient: vi.fn(),
  getAppSession: vi.fn(),
  recordCoupleActivity: vi.fn(),
  queuePartnerEmail: vi.fn(),
  revalidatePath: vi.fn(),
  resolvePlaceLocation: vi.fn(),
}));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/features/places/location", () => ({ resolvePlaceLocation: mocks.resolvePlaceLocation }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient, createServiceClient: mocks.createServiceClient }));
vi.mock("@/features/auth/session", () => ({ getAppSession: mocks.getAppSession }));
vi.mock("@/features/collaboration/activityServer", () => ({ recordCoupleActivity: mocks.recordCoupleActivity, queuePartnerEmail: mocks.queuePartnerEmail }));

import { clearCoupleActivities, dismissCoupleActivities } from "./collaboration/actions";
import { createNotesBatch, deleteNote, reorderNotes, updateNoteContent, updateNoteStatus } from "./lists/actions";
import { createMemory, deleteMemory, listMemories, listMemoryCalendarMarks, signMemoryPhotoUrls, updateMemory } from "./memories/actions";
import { archiveTripPlan, loadCouplePlan, openDateDay, saveCouplePlan } from "./planning/actions";
import type { PlanItem } from "./planning/types/plan";
import { loadTasteBoard, saveTasteProfile } from "./taste/actions";
import { createPlace, listPlaces } from "./places/actions";
import type { TasteInput } from "./taste/types";
import type { UpdateMemoryInput } from "./memories/types";

function query(result: { data?: unknown; error?: unknown } = { data: [], error: null }) {
  const methods = ["select", "returns", "eq", "neq", "in", "not", "is", "order", "limit", "maybeSingle", "single", "insert", "upsert", "update", "delete"] as const;
  const chain = Object.fromEntries(methods.map(method => [method, vi.fn(() => chain)])) as Record<typeof methods[number], ReturnType<typeof vi.fn>> & PromiseLike<typeof result>;
  chain.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

function client(...queries: ReturnType<typeof query>[]) {
  const from = vi.fn();
  for (const item of queries) from.mockReturnValueOnce(item);
  const rpc = vi.fn().mockResolvedValue({ data: { plan_id: "plan-1", version: 2, revision: 5 }, error: null });
  const createSignedUrls = vi.fn().mockResolvedValue({ data: [], error: null });
  const storage = { from: vi.fn(() => ({ createSignedUrls, remove: vi.fn().mockResolvedValue({ error: null }) })) };
  const db = { from, rpc, storage, createSignedUrls };
  mocks.createClient.mockResolvedValue(db);
  return db;
}

const stop: PlanItem = { id: "stop-1", placeId: "discover:kakao:1", placeName: "새로 고른 장소", category: "카페", startTime: "10:00", durationMinutes: 60, expectedCost: 10000, order: 0, memo: "", dayIndex: 0, coordinates: [127.1, 37.5] };
const storedPlan = { id: "plan-1", kind: "date", title: "데이트", subtitle: "", start_date: "2026-10-11", day_count: 1, revision_id: 4 };
const storedStop = { client_id: "stop-1", place_id: stop.placeId, place_name: "예전 장소", category: "카페", start_time: "10:00", duration_minutes: 60, expected_cost: 10000, sort_order: 0, memo: "", day_index: 0, lng: 127.1, lat: 37.5 };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAppSession.mockResolvedValue({ mode: "authenticated", coupleId: "couple-1", userId: "user-1", displayName: "나", partner: null });
  mocks.createServiceClient.mockReturnValue(null);
  mocks.recordCoupleActivity.mockResolvedValue({ ok: true });
  mocks.resolvePlaceLocation.mockResolvedValue({ address: "서울 성수동", roadAddress: "", district: "성수", coordinates: [127, 37] });
});

describe("transactional plan saving", () => {
  it("rejects malformed items before a database mutation", async () => {
    const db = client();
    expect(await saveCouplePlan("date", [null] as unknown as PlanItem[])).toHaveProperty("error");
    expect(await saveCouplePlan("date", [stop, stop])).toHaveProperty("error");
    expect(await saveCouplePlan("date", [{ ...stop, startTime: "25:00" }])).toHaveProperty("error");
    expect(db.from).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("does not delete any items when the atomic RPC is missing", async () => {
    const plan = query({ data: storedPlan, error: null });
    const items = query({ data: [storedStop], error: null });
    const db = client(plan, items);
    db.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "function not found" } });
    expect(await saveCouplePlan("date", [stop], { expectedRevision: 4 })).toHaveProperty("error");
    expect(db.from).toHaveBeenCalledTimes(2);
    expect(plan.update).not.toHaveBeenCalled();
    expect(items.delete).not.toHaveBeenCalled();
    expect(items.insert).not.toHaveBeenCalled();
  });

  it("passes coordinates and a revision guard in the single atomic write", async () => {
    const db = client(query({ data: storedPlan, error: null }), query({ data: [storedStop], error: null }));
    expect(await saveCouplePlan("date", [stop])).toEqual({ ok: true, version: 2, revision: 5 });
    expect(db.rpc).toHaveBeenCalledWith("save_couple_plan_atomic", expect.objectContaining({ expected_revision: 4, target_items: [expect.objectContaining({ lng: 127.1, lat: 37.5 })] }));
    expect(db.from).toHaveBeenCalledTimes(2);
  });

  it("does not recreate an archived day's draft when advancing with preservation disabled", async () => {
    const plan = query({ data: storedPlan, error: null });
    const items = query({ data: [storedStop], error: null });
    const db = client(plan, items);

    const saved = await saveCouplePlan("date", [stop], {
      title: "다음 데이트",
      startDate: "2026-10-12",
      expectedRevision: 4,
      preservePreviousDate: false,
    });

    expect(saved).toEqual({ ok: true, version: 2, revision: 5 });
    expect(db.from.mock.calls.map(call => call[0])).toEqual(["plans", "plan_items"]);
    expect(plan.upsert).not.toHaveBeenCalled();
    expect(items.upsert).not.toHaveBeenCalled();
    expect(db.rpc).toHaveBeenCalledTimes(1);
    expect(db.rpc).toHaveBeenCalledWith("save_couple_plan_atomic", expect.objectContaining({
      target_title: "다음 데이트",
      target_start_date: "2026-10-12",
      expected_revision: 4,
      target_items: [expect.objectContaining({ place_name: "새로 고른 장소" })],
    }));
  });

  it("preserves the previous day's draft by default before a normal date change", async () => {
    const draft = query({ data: null, error: null });
    const db = client(
      query({ data: storedPlan, error: null }),
      query({ data: [storedStop], error: null }),
      draft,
    );

    expect(await saveCouplePlan("date", [stop], {
      startDate: "2026-10-12",
      expectedRevision: 4,
    })).toEqual({ ok: true, version: 2, revision: 5 });

    expect(db.from.mock.calls.map(call => call[0])).toEqual(["plans", "plan_items", "date_drafts"]);
    expect(draft.upsert).toHaveBeenCalledTimes(1);
    expect(draft.upsert).toHaveBeenCalledWith(expect.objectContaining({
      couple_id: "couple-1",
      scheduled_on: "2026-10-11",
      title: "데이트",
      items: [expect.objectContaining({ id: "stop-1", placeName: "예전 장소" })],
    }), { onConflict: "couple_id,scheduled_on" });
    expect(db.rpc).toHaveBeenCalledWith("save_couple_plan_atomic", expect.objectContaining({
      target_start_date: "2026-10-12",
      expected_revision: 4,
    }));
    expect(draft.upsert.mock.invocationCallOrder[0]).toBeLessThan(db.rpc.mock.invocationCallOrder[0]);
  });

  it("never writes after a failed read of the previous plan", async () => {
    const db = client(query({ data: null, error: { code: "08006", message: "connection lost" } }));
    expect(await saveCouplePlan("date", [stop])).toHaveProperty("error");
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("checks the caller revision before preserving another day's draft", async () => {
    const db = client(query({ data: storedPlan, error: null }));
    expect(await saveCouplePlan("date", [stop], { startDate: "2026-10-12", expectedRevision: 3 })).toMatchObject({ conflict: true });
    expect(db.rpc).not.toHaveBeenCalled();
    expect(db.from).toHaveBeenCalledTimes(1);
  });

  it("keeps plan loading read-only even when a legacy demo is hidden", async () => {
    const plan = query({ data: { ...storedPlan, title: "군산에서 머문 이틀" }, error: null });
    const items = query({ data: [{ ...storedStop, client_id: "gunsan-d1-1", place_id: "gunsan-history" }], error: null });
    const db = client(plan, items);
    expect((await loadCouplePlan("trip")).items).toEqual([]);
    expect(db.from).toHaveBeenCalledTimes(2);
    expect(plan.update).not.toHaveBeenCalled();
    expect(items.delete).not.toHaveBeenCalled();
  });

  it("keeps unsaved edits when switching dates instead of overwriting them with the old snapshot", async () => {
    const stashed = query({ data: null, error: null });
    const db = client(
      query({ data: storedPlan, error: null }), query({ data: [storedStop], error: null }),
      query({ data: [], error: null }), stashed,
      query({ data: storedPlan, error: null }), query({ data: [storedStop], error: null }),
      query({ data: null, error: null }),
    );
    const result = await openDateDay({ fromDate: "2026-10-11", toDate: "2026-10-12", expectedRevision: 4, snapshot: { title: "수정 중", notes: "아직 저장 전", items: [stop] } });
    expect(result).toHaveProperty("ok", true);
    expect(stashed.upsert).toHaveBeenCalledWith(expect.objectContaining({ title: "수정 중", items: [stop] }), expect.anything());
    expect(db.from.mock.calls.filter(call => call[0] === "date_drafts")).toHaveLength(2);
  });
});

describe("archive integrity", () => {
  it("rolls back a new archive if its itinerary snapshot could not be saved", async () => {
    const rollback = query({ data: null, error: null });
    const db = client(query({ data: { id: "archive-memory" }, error: null }), rollback);
    mocks.recordCoupleActivity.mockResolvedValue({ error: "기록 저장 실패" });
    expect(await archiveTripPlan({ title: "여행", startDate: "2026-10-11", dayCount: 1, items: [stop] })).toHaveProperty("error");
    expect(rollback.delete).toHaveBeenCalledTimes(1);
    expect(rollback.eq).toHaveBeenCalledWith("couple_id", "couple-1");
    expect(db.from).toHaveBeenCalledTimes(2);
  });
});

describe("feed deletion preserves feature storage", () => {
  it("clears visible stories while retaining archive, draft, insight and memo data", async () => {
    const remove = query({ data: [{ id: "story" }], error: null });
    const hide = query({ data: [{ id: "archive" }], error: null });
    client(remove, hide);
    expect(await clearCoupleActivities()).toEqual({ ok: true });
    expect(remove.not).toHaveBeenCalledWith("entity_type", "in", "(date_draft,date_archive,trip_archive,couple_insight,place_memo)");
    expect(hide.update).toHaveBeenCalledWith({ title: "", detail: "" });
    expect(hide.in).toHaveBeenCalledWith("entity_type", expect.arrayContaining(["date_archive", "trip_archive"]));
    expect(hide.delete).not.toHaveBeenCalled();
  });

  it("dismissing an archived story hides it while preserving its snapshot", async () => {
    const remove = query({ data: [], error: null });
    const hide = query({ data: [{ id: "archive" }], error: null });
    client(remove, hide);
    expect(await dismissCoupleActivities(["archive"])).toEqual({ ok: true });
    expect(hide.in).toHaveBeenCalledWith("id", ["archive"]);
    expect(hide.update).toHaveBeenCalledWith({ title: "", detail: "" });
  });
});

describe("bulk notes", () => {
  it("saves all scanned reservations in one insert", async () => {
    const inserted = query({ data: [{ id: "note", kind: "vault", title: "예약", detail: "", extra: "", status: "kept", created_at: "now", created_by: "user-1" }], error: null });
    client(query({ data: { sort_order: -2 }, error: null }), inserted);
    const input = ["기차", "호텔", "렌터카"].map(title => ({ title, detail: "", extra: "" }));
    expect(await createNotesBatch("vault", input)).toHaveProperty("notes");
    expect(inserted.insert).toHaveBeenCalledTimes(1);
    expect(inserted.insert.mock.calls[0][0]).toHaveLength(3);
    expect(mocks.recordCoupleActivity).toHaveBeenCalledTimes(1);
  });

  it("validates the entire batch before saving any item", async () => {
    expect(await createNotesBatch("vault", [{ title: "기차", detail: "", extra: "" }, { title: " ", detail: "", extra: "" }])).toHaveProperty("error");
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("rejects a status from another list", async () => {
    const db = client(query({ data: { kind: "gift" }, error: null }));
    expect(await updateNoteStatus("note", "kept")).toHaveProperty("error");
    expect(db.from).toHaveBeenCalledTimes(1);
  });
});

describe("memory integrity and photo loading", () => {
  it("reports read errors without pretending memories disappeared", async () => {
    client(query({ data: null, error: { message: "offline" } }));
    await expect(listMemories()).rejects.toThrow("추억을 불러오지 못했어요");
  });

  it("does not delete a memory when its storage paths cannot be loaded", async () => {
    const db = client(query({ data: { id: "memory", title: "추억" }, error: null }), query({ data: null, error: { message: "offline" } }));
    expect(await deleteMemory("memory")).toHaveProperty("error");
    expect(db.from).toHaveBeenCalledTimes(2);
  });

  it("rejects photo paths belonging to another couple", async () => {
    const db = client();
    expect(await createMemory({ title: "추억", description: "", happenedOn: "2026-10-11", locationLabel: "", photos: [{ storagePath: "other-couple/private.jpg" }] })).toHaveProperty("error");
    expect(db.from).not.toHaveBeenCalled();
  });

  it("signs the permitted photos in one storage request", async () => {
    const db = client(query({ data: [{ id: "photo-a", memory_id: "memory", storage_path: "couple-1/a.jpg" }, { id: "photo-b", memory_id: "memory", storage_path: "couple-1/b.jpg" }, { id: "foreign", memory_id: "other", storage_path: "other/x.jpg" }], error: null }), query({ data: [{ id: "memory" }], error: null }));
    db.createSignedUrls.mockResolvedValue({ data: [{ path: "couple-1/a.jpg", signedUrl: "https://photo/a" }, { path: "couple-1/b.jpg", signedUrl: "https://photo/b" }], error: null });
    expect(await signMemoryPhotoUrls(["photo-a", "photo-b", "foreign"])).toEqual({ "photo-a": "https://photo/a", "photo-b": "https://photo/b" });
    expect(db.createSignedUrls).toHaveBeenCalledTimes(1);
    expect(db.createSignedUrls).toHaveBeenCalledWith(["couple-1/a.jpg", "couple-1/b.jpg"], 3600);
  });
});


const oldMemory = { id: "memory", memory_type: "free", place_id: null, title: "예전 추억", happened_on: "2026-10-11", description: "예전 메모", location_label: "서울", lng: 127, lat: 37, created_by: "user-1", created_at: "2026-10-11T00:00:00Z" };
const oldPhoto = { id: "old-photo", memory_id: "memory", storage_url: "", caption: "", sort_order: 2, latitude: 35, longitude: 129, captured_at: null, storage_path: "couple-1/old.jpg", original_filename: "old.jpg", mime_type: "image/jpeg", file_size: 50, width: 1, height: 1, camera_make: "", camera_model: "", location_source: "exif" };
const memoryEdit: UpdateMemoryInput = { id: "memory", attemptId: "11111111-1111-4111-8111-111111111111", expectedSnapshot: JSON.stringify([oldMemory.title, oldMemory.happened_on, oldMemory.description, oldMemory.location_label, oldMemory.memory_type, [oldMemory.lng, oldMemory.lat]]), title: "새 추억", happenedOn: "2026-10-12", description: "새 메모", locationLabel: "새 장소", memoryType: "free", lng: 126, lat: 36, photos: [{ storagePath: "couple-1/new.jpg", latitude: 35.2, longitude: 129.2, locationSource: "exif" }] };
const noteRow = { id: "note", kind: "bucket", title: "함께 걷기", detail: "", extra: "", status: "wish", created_at: "2026-10-11T00:00:00Z", created_by: "user-1", updated_at: "2026-10-11T01:00:00Z" };
const tasteInput: TasteInput = { areas: ["성수"], pace: "mixed", activities: ["cafe"], cuisines: ["한식"], avoidFoods: [], setting: "mix", crowd: "quiet", budget: "comfortable", timeWindow: "afternoon", areaScope: "walkable", dateFlow: "flex", drink: "any", indoorPlay: "", note: "새 기준" };

describe("concurrent shared notes", () => {
  it("guards edited content with the version when editing began", async () => {
    const update = query({ data: null, error: null });
    client(update);
    expect(await updateNoteContent("note", { detail: "내 변경" }, noteRow.updated_at)).toHaveProperty("error");
    expect(update.eq).toHaveBeenCalledWith("updated_at", noteRow.updated_at);
    expect(mocks.recordCoupleActivity).not.toHaveBeenCalled();
  });

  it("returns the new status version and announces it to the partner", async () => {
    const update = query({ data: { ...noteRow, status: "done", updated_at: "new-version" }, error: null });
    client(query({ data: { kind: "bucket" }, error: null }), update);
    expect(await updateNoteStatus("note", "done", noteRow.updated_at)).toMatchObject({ ok: true, note: { updatedAt: "new-version", status: "done" } });
    expect(update.eq).toHaveBeenCalledWith("updated_at", noteRow.updated_at);
    expect(mocks.recordCoupleActivity).toHaveBeenCalledWith(expect.objectContaining({ action: "BUCKET_UPDATED", entityId: "note" }));
  });

  it("treats a partner's already deleted item as successfully deleted", async () => {
    client(query({ data: null, error: null }));
    expect(await deleteNote("already-deleted")).toEqual({ ok: true });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/bucket");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/gifts");
  });

  it("reports partially changed ordering and broadcasts the actual saved changes", async () => {
    const first = query({ data: { id: "first" }, error: null });
    const deletedByPartner = query({ data: null, error: null });
    client(query({ data: [{ id: "first" }, { id: "second" }], error: null }), first, deletedByPartner);
    expect(await reorderNotes("bucket", ["first", "second"])).toHaveProperty("error");
    expect(first.select).toHaveBeenCalledWith("id");
    expect(deletedByPartner.maybeSingle).toHaveBeenCalled();
    expect(mocks.recordCoupleActivity).toHaveBeenCalledWith(expect.objectContaining({ action: "BUCKET_UPDATED" }));
  });
});

describe("shared memory edit integrity", () => {
  it("uses the database snapshot guard without a separate read/write race", async () => {
    const db = client();
    db.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "Memory edit conflict" } });
    expect(await updateMemory(memoryEdit)).toMatchObject({ conflict: true });
    expect(db.from).not.toHaveBeenCalled();
    expect(db.rpc).toHaveBeenCalledWith("update_memory_atomic", expect.objectContaining({
      target_expected: JSON.parse(memoryEdit.expectedSnapshot!),
    }));
  });

  it("does not change story or photos through a nonatomic fallback on rejection", async () => {
    const db = client();
    db.rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "Photo upload is not available" } });
    expect(await updateMemory(memoryEdit)).toHaveProperty("error");
    expect(db.from).not.toHaveBeenCalled();
    expect(mocks.recordCoupleActivity).not.toHaveBeenCalled();
  });

  it("releases new uploads only after a definite atomic transaction conflict", async () => {
    const db = client();
    db.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "Memory edit conflict" } });
    const result = await updateMemory(memoryEdit);
    expect(result).toMatchObject({ conflict: true });
    expect(result).not.toHaveProperty("keepUploadedPhotos", true);
    expect(db.from).not.toHaveBeenCalled();
    expect(mocks.recordCoupleActivity).not.toHaveBeenCalled();
  });

  it("protects uploaded files when the transaction response is uncertain", async () => {
    const db = client();
    db.rpc.mockRejectedValue(new TypeError("offline"));
    expect(await updateMemory(memoryEdit)).toMatchObject({ keepUploadedPhotos: true });
    expect(db.from).not.toHaveBeenCalled();
  });

  it("preserves original EXIF locations while editing the memory location", async () => {
    const db = client();
    db.rpc.mockResolvedValue({ data: { memory: { ...oldMemory, title: "새 추억", lng: 126, lat: 36 },
      photos: [oldPhoto, { ...oldPhoto, id: "new-photo", sort_order: 3, latitude: 35.2, longitude: 129.2 }] }, error: null });
    const result = await updateMemory(memoryEdit);
    expect(result).toHaveProperty("memory");
    if ("memory" in result) expect(result.memory.photos[0]).toMatchObject({ latitude: 35, longitude: 129, locationSource: "exif" });
    expect(db.from).not.toHaveBeenCalled();
    expect(db.rpc).toHaveBeenCalledWith("update_memory_atomic", expect.objectContaining({
      target_photos: [expect.objectContaining({ latitude: 35.2, longitude: 129.2, location_source: "exif" })],
    }));
  });

  it("does not turn a failed calendar read into an empty calendar", async () => {
    client(query({ data: null, error: { message: "offline" } }));
    await expect(listMemoryCalendarMarks()).rejects.toThrow("캘린더의 추억을 불러오지 못했어요");
  });

  it("accepts a partner's completed deletion without keeping a ghost viewer", async () => {
    const db = client(query({ data: null, error: null }));
    expect(await deleteMemory("already-deleted")).toEqual({ ok: true });
    expect(db.from).toHaveBeenCalledTimes(1);
  });
});

describe("taste read and mutation replies", () => {
  it("reports a database read failure instead of erasing saved profiles", async () => {
    client(query({ data: null, error: { message: "offline" } }));
    await expect(loadTasteBoard()).rejects.toThrow("취향을 불러오지 못했어요");
  });

  it("does not write when the existing board cannot be read", async () => {
    const read = query({ data: null, error: { message: "offline" } });
    const db = client(read);
    expect(await saveTasteProfile(tasteInput)).toHaveProperty("error");
    expect(db.from).toHaveBeenCalledTimes(1);
    expect(read.upsert).not.toHaveBeenCalled();
  });

  it("returns the just saved profile without another cached or failed board read", async () => {
    const saved = query({ data: { user_id: "user-1" }, error: null });
    const db = client(query({ data: [], error: null }), saved);
    expect(await saveTasteProfile(tasteInput)).toMatchObject({ you: { areas: ["성수"], note: "새 기준" }, partner: null });
    expect(db.from).toHaveBeenCalledTimes(2);
    expect(saved.upsert).toHaveBeenCalledWith(expect.objectContaining({ note: "새 기준", user_id: "user-1", couple_id: "couple-1" }), { onConflict: "couple_id,user_id" });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/insights");
  });
});


describe("shared place reads", () => {
  it("does not misrepresent a failed preference read as unrated places", async () => {
    client(query({ data: [{ id: "place" }], error: null }), query({ data: null, error: { message: "offline" } }), query({ data: [], error: null }));
    await expect(listPlaces()).rejects.toThrow("둘의 장소 평가를 불러오지 못했어요");
  });

  it("does not hide missing memo metadata when its read failed", async () => {
    client(query({ data: [{ id: "place" }], error: null }), query({ data: [], error: null }), query({ data: null, error: { message: "offline" } }));
    await expect(listPlaces()).rejects.toThrow("장소 메모 정보를 불러오지 못했어요");
  });
});


const manualAttemptId = "11111111-1111-4111-8111-111111111111";
const manualInput = { attemptId: manualAttemptId, name: "우리 카페", category: "cafe" as const, district: "서울 성수동", description: "우리의 메모", durationMinutes: 60, expectedCostTwo: null };
const manualPlaceRow = { id: manualAttemptId, couple_id: "couple-1", created_by: "user-1", name: "우리 카페", category: "cafe", category_label: "카페", district: "성수", address: "서울 성수동", road_address: null, description: "우리의 메모", duration_minutes: 60, expected_cost_two: null, lng: 127, lat: 37, image: null, map_url: null, phone: null, opening_hours: null, visual_tone: "brown", external_source: "manual", external_place_id: null, created_at: "2026-10-11T00:00:00Z", updated_at: "2026-10-11T00:00:00Z" };
const manualPreference = { place_id: manualAttemptId, user_id: "user-1", status: "want", fit: 0, updated_at: "2026-10-11T00:00:00Z" };

describe("idempotent manual place saving", () => {
  it("rejects missing or invalid submission identities before remote reads", async () => {
    expect(await createPlace({ ...manualInput, attemptId: "invalid" })).toHaveProperty("error");
    expect(await createPlace({ ...manualInput, attemptId: undefined as unknown as string })).toHaveProperty("error");
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("finishes the preference step after a partial failure without inserting the place again", async () => {
    const insertedPlace = query({ data: manualPlaceRow, error: null });
    const firstPreference = query({ data: null, error: { message: "offline" } });
    const retryRead = query({ data: manualPlaceRow, error: null });
    const retryPreference = query({ data: manualPreference, error: null });
    const db = client(query({ data: null, error: null }), insertedPlace,
      query({ data: [], error: null }), firstPreference, query({ data: [], error: null }),
      retryRead, query({ data: [], error: null }), retryPreference);

    expect(await createPlace(manualInput)).toHaveProperty("error");
    expect(await createPlace(manualInput)).toMatchObject({ place: { id: manualAttemptId, userStatus: "want" } });
    expect(insertedPlace.insert).toHaveBeenCalledWith(expect.objectContaining({ id: manualAttemptId, couple_id: "couple-1", created_by: "user-1" }));
    expect(retryRead.insert).not.toHaveBeenCalled();
    expect(db.from.mock.calls.filter(([table]) => table === "places")).toHaveLength(3);
    expect(mocks.resolvePlaceLocation).toHaveBeenCalledTimes(1);
    expect(retryPreference.insert).toHaveBeenCalledWith(expect.objectContaining({ place_id: manualAttemptId, status: "want" }));
  });

  it("recovers a saved row after its insert response was lost", async () => {
    const uncertainInsert = query({ data: null, error: { message: "response lost", code: "08006" } });
    const recovered = query({ data: manualPlaceRow, error: null });
    client(query({ data: null, error: null }), uncertainInsert, recovered, query({ data: [manualPreference], error: null }));
    expect(await createPlace(manualInput)).toMatchObject({ place: { id: manualAttemptId, name: "우리 카페" } });
    expect(uncertainInsert.insert).toHaveBeenCalledTimes(1);
    expect(recovered.insert).not.toHaveBeenCalled();
    expect(mocks.queuePartnerEmail).not.toHaveBeenCalled();
  });

  it("does not overwrite later edits or statuses when a completed request is replayed", async () => {
    const existing = query({ data: { ...manualPlaceRow, description: "파트너가 다듬은 메모" }, error: null });
    const preferences = query({ data: [{ ...manualPreference, status: "neutral", fit: 4 }], error: null });
    client(existing, preferences);
    expect(await createPlace(manualInput)).toMatchObject({ place: { description: "파트너가 다듬은 메모", userStatus: "neutral", userFit: 4 } });
    expect(existing.insert).not.toHaveBeenCalled();
    expect(existing.update).not.toHaveBeenCalled();
    expect(preferences.insert).not.toHaveBeenCalled();
    expect(preferences.upsert).not.toHaveBeenCalled();
    expect(mocks.resolvePlaceLocation).not.toHaveBeenCalled();
    expect(mocks.recordCoupleActivity).not.toHaveBeenCalled();
    expect(mocks.queuePartnerEmail).not.toHaveBeenCalled();
  });

  it("does not adopt a UUID belonging to another creator or couple", async () => {
    const before = query({ data: null, error: null });
    const collision = query({ data: null, error: { code: "23505" } });
    const after = query({ data: null, error: null });
    const db = client(before, collision, after);
    expect(await createPlace(manualInput)).toHaveProperty("error");
    for (const read of [before, after]) {
      expect(read.eq).toHaveBeenCalledWith("couple_id", "couple-1");
      expect(read.eq).toHaveBeenCalledWith("created_by", "user-1");
      expect(read.eq).toHaveBeenCalledWith("external_source", "manual");
    }
    expect(db.from).not.toHaveBeenCalledWith("place_preferences");
  });

  it("resolves a preference insert collision without resetting a newer status", async () => {
    const insertion = query({ data: null, error: { code: "23505" } });
    client(query({ data: manualPlaceRow, error: null }), query({ data: [], error: null }), insertion, query({ data: [{ ...manualPreference, status: "visited", fit: 5 }], error: null }));
    expect(await createPlace(manualInput)).toMatchObject({ place: { userStatus: "visited", userFit: 5 } });
    expect(insertion.upsert).not.toHaveBeenCalled();
    expect(mocks.queuePartnerEmail).not.toHaveBeenCalled();
  });

  it("stops before inserting when the previous attempt cannot be checked", async () => {
    const read = query({ data: null, error: { message: "offline" } });
    const db = client(read);
    expect(await createPlace(manualInput)).toHaveProperty("error");
    expect(db.from).toHaveBeenCalledTimes(1);
    expect(read.insert).not.toHaveBeenCalled();
    expect(mocks.resolvePlaceLocation).not.toHaveBeenCalled();
  });

  it("concurrent retries share one row and one preference using the primary key", async () => {
    let savedPlace: typeof manualPlaceRow | null = null;
    let savedPreference: typeof manualPreference | null = null;
    let insertedPlaceCount = 0;
    let insertedPreferenceCount = 0;
    const db = client();
    db.from.mockImplementation((table: string) => {
      const chain = query();
      chain.then = (resolve, reject) => Promise.resolve().then(() => {
        if (table === "places") {
          if (chain.insert.mock.calls.length) {
            expect(chain.insert.mock.calls[0][0]).toMatchObject({ id: manualAttemptId, couple_id: "couple-1", created_by: "user-1" });
            if (savedPlace) return { data: null, error: { code: "23505" } };
            savedPlace = manualPlaceRow;
            insertedPlaceCount += 1;
          }
          return { data: savedPlace, error: null };
        }
        if (chain.insert.mock.calls.length) {
          if (savedPreference) return { data: null, error: { code: "23505" } };
          savedPreference = manualPreference;
          insertedPreferenceCount += 1;
          return { data: savedPreference, error: null };
        }
        return { data: savedPreference ? [savedPreference] : [], error: null };
      }).then(resolve, reject);
      return chain;
    });
    const results = await Promise.all([createPlace(manualInput), createPlace(manualInput)]);
    expect(results).toEqual([expect.objectContaining({ place: expect.objectContaining({ id: manualAttemptId, userStatus: "want" }) }), expect.objectContaining({ place: expect.objectContaining({ id: manualAttemptId, userStatus: "want" }) })]);
    expect(insertedPlaceCount).toBe(1);
    expect(insertedPreferenceCount).toBe(1);
    expect(mocks.recordCoupleActivity).toHaveBeenCalledTimes(1);
    expect(mocks.queuePartnerEmail).toHaveBeenCalledTimes(1);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), places: vi.fn(), memories: vi.fn(), plan: vi.fn() }));
vi.mock("@/features/auth/session", () => ({ getAppSession: mocks.session }));
vi.mock("@/features/places/actions", () => ({ listPlaces: mocks.places }));
vi.mock("@/features/memories/actions", () => ({ listMemories: mocks.memories }));
vi.mock("@/features/planning/actions", () => ({ loadCouplePlan: mocks.plan }));
import { searchWorkspace } from "./actions";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ mode: "authenticated" });
  mocks.places.mockResolvedValue({ places: [{ id: "place-1", name: "성수 첫 카페", categoryLabel: "카페", district: "서울숲" }] });
  mocks.memories.mockResolvedValue({ memories: [{ title: "성수 산책", locationLabel: "서울숲", happenedOn: "2026-10-11" }] });
  mocks.plan.mockImplementation(async kind => ({ title: kind === "date" ? "성수 하루" : "우리 여행", items: [{}] }));
});

describe("workspace search boundary", () => {
  it.each([null, undefined, {}, [], 1, " ", "a".repeat(257)])("ignores malformed or empty search input without workspace reads", async value => {
    expect(await searchWorkspace(value as string)).toEqual([]);
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.places).not.toHaveBeenCalled();
  });
  it.each(["guest", "setup_error"])("checks %s access before searching all record sources", async mode => {
    mocks.session.mockResolvedValue({ mode });
    expect(await searchWorkspace("성수")).toEqual([]);
    expect(mocks.places).not.toHaveBeenCalled();
    expect(mocks.memories).not.toHaveBeenCalled();
    expect(mocks.plan).not.toHaveBeenCalled();
  });
  it("matches multiple words across a record's name and district", async () => {
    const result = await searchWorkspace("성수   서울숲");
    expect(result.map(hit => hit.group)).toEqual(["장소", "추억"]);
    expect(mocks.memories).toHaveBeenCalledWith({ photos: "none" });
    expect(mocks.plan).toHaveBeenCalledWith("trip");
    expect(mocks.plan).toHaveBeenCalledWith("date");
  });
  it("matches visually identical composed Korean and full-width text", async () => {
    mocks.places.mockResolvedValue({ places: [{ id: "place-1", name: "ABC 카페", categoryLabel: "카페", district: "성수" }] });
    expect((await searchWorkspace(`ＡＢＣ ${"성수".normalize("NFD")}`))[0].label).toBe("ABC 카페");
  });
  it("encodes the selected place identifier as a single query value", async () => {
    mocks.places.mockResolvedValue({ places: [{ id: "id&from=date", name: "성수", categoryLabel: "카페", district: "서울숲" }] });
    expect((await searchWorkspace("성수"))[0].href).toBe("/places?selected=id%26from%3Ddate");
  });
  it("caps matching results at twelve", async () => {
    mocks.places.mockResolvedValue({ places: Array.from({ length: 30 }, (_, index) => ({ id: `${index}`, name: `성수 ${index}`, categoryLabel: "카페", district: "서울숲" })) });
    expect(await searchWorkspace("성수")).toHaveLength(12);
  });
  it("propagates a failed record source rather than claiming there are no records", async () => {
    mocks.memories.mockRejectedValue(new Error("offline"));
    await expect(searchWorkspace("성수")).rejects.toThrow("offline");
  });
});

import { afterEach, expect, it, vi } from "vitest";
import { dateDesignRuntime } from "./dateDesignRuntime";
import { courseProposalSchema } from "./courseProposalSchema";

afterEach(() => vi.unstubAllEnvs());
it("ends stalled research at the shared deadline without leaving a rejected promise", async () => {
  const controller = new AbortController();
  const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
  try {
    const runtime = dateDesignRuntime();
    const pending = runtime.untilDeadline(new Promise<string>(() => {}), "provider facts");
    controller.abort();
    expect(await pending).toBe("provider facts");
    expect(runtime.canGenerate()).toBe(false);
  } finally { timeout.mockRestore(); }
});
it("shares one repair between structural and routing failures", () => {
  let time = 0;
  const runtime = dateDesignRuntime(() => time);
  expect(runtime.claimRepair()).toBe(true);
  expect(runtime.claimRepair()).toBe(false);
  time = runtime.timeoutMs - 500;
  expect(runtime.canGenerate()).toBe(false);
});
it.each(["-1", "Infinity", "garbage", "120000"])("keeps bounded defaults for invalid timeout %s", configured => {
  vi.stubEnv("DATE_ENGINE_DESIGN_TIMEOUT_MS", configured);
  expect(dateDesignRuntime().timeoutMs).toBe(45000);
});
it("does not launch a repair with too little time left", () => {
  vi.stubEnv("DATE_ENGINE_DESIGN_TIMEOUT_MS", "5000");
  let time = 0;
  const runtime = dateDesignRuntime(() => time);
  time = 3600;
  expect(runtime.claimRepair()).toBe(false);
});

it("uses the remaining orchestration budget instead of restarting the full design timer", () => {
  let time = 0;
  const runtime = dateDesignRuntime(() => time, { timeoutMs: 2300 });
  expect(runtime.timeoutMs).toBe(2300);
  time = 1800;
  expect(runtime.canGenerate()).toBe(false);
  expect(runtime.claimRepair()).toBe(false);
});
it("preserves a large provider whitelist within per-enum schema limits", () => {
  const ids = Array.from({ length: 500 }, (_, index) => `kakao:${String(index).padStart(6, "0")}-${"x".repeat(35)}`);
  const schema = courseProposalSchema(ids, 7, 500);
  const id = schema.schema.properties.courses.items.properties.selected.items.properties.id;
  expect(id.anyOf?.flatMap(branch => branch.enum)).toEqual(ids);
  expect(id.anyOf?.every(branch => branch.enum.length <= 250)).toBe(true);
});

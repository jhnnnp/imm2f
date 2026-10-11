import { afterEach, expect, it, vi } from "vitest";
import { getOpenAiModel, getOpenAiSearchModel, normalizeOpenAiModel } from "./env";

afterEach(() => vi.unstubAllEnvs());

it("converts display labels to API IDs while preserving model choice", () => {
  expect(normalizeOpenAiModel(" gpt-5.6 Luna ")).toBe("gpt-5.6-luna");
  expect(normalizeOpenAiModel("GPT-6 Sol")).toBe("gpt-6-sol");
  expect(normalizeOpenAiModel("gpt-4.1-2025-04-14")).toBe("gpt-4.1-2025-04-14");
  expect(normalizeOpenAiModel(undefined)).toBe("");
});

it.each(["gpt-4o-mini", "gpt-4o-mini-2024-07-18", "gpt-4o", "gpt-4-turbo", "gpt-4.1-nano", "o3-mini"])
("uses a search-capable model when the chat model %s cannot use hosted web search", model => {
  vi.stubEnv("OPENAI_MODEL", model);
  vi.stubEnv("OPENAI_SEARCH_MODEL", "");
  expect(getOpenAiModel()).toBe(model);
  expect(getOpenAiSearchModel()).toBe("gpt-4.1-mini");
});

it.each(["gpt-4.1-mini", "gpt-4.1-mini-2025-04-14", "gpt-5.4-mini", "gpt-5.6-terra", "gpt-6-sol"])
("preserves a capable selected search model %s", model => {
  vi.stubEnv("OPENAI_MODEL", "gpt-4o-mini");
  vi.stubEnv("OPENAI_SEARCH_MODEL", model);
  expect(getOpenAiSearchModel()).toBe(model);
});

it("repairs an explicitly configured legacy chat-only search model without changing the chat model", () => {
  vi.stubEnv("OPENAI_MODEL", "gpt-5.6 Terra");
  vi.stubEnv("OPENAI_SEARCH_MODEL", "gpt-4o-mini");
  expect(getOpenAiModel()).toBe("gpt-5.6-terra");
  expect(getOpenAiSearchModel()).toBe("gpt-4.1-mini");
});

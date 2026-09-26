import { expect, it } from "vitest";
import { normalizeOpenAiModel } from "./env";

it("converts display labels to API IDs while preserving model choice", () => {
  expect(normalizeOpenAiModel(" gpt-5.6 Luna ")).toBe("gpt-5.6-luna");
  expect(normalizeOpenAiModel("GPT-6 Sol")).toBe("gpt-6-sol");
  expect(normalizeOpenAiModel("gpt-4.1-2025-04-14")).toBe("gpt-4.1-2025-04-14");
  expect(normalizeOpenAiModel(undefined)).toBe("");
});

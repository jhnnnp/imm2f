export function getOpenAiApiKey() {
  return process.env.OPENAI_API_KEY?.trim() ?? "";
}

export function getOpenAiModel() {
  return process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
}

export function isOpenAiConfigured() {
  return getOpenAiApiKey().length > 0;
}

export function getOpenAiApiKey() {
  return process.env.OPENAI_API_KEY?.trim() ?? "";
}

export function getOpenAiModel() {
  return process.env.OPENAI_MODEL?.trim() || "gpt-5.6-terra";
}

export function isOpenAiConfigured() {
  return getOpenAiApiKey().length > 0;
}

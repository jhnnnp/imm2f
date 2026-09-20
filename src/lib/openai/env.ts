export function getOpenAiApiKey() {
  return process.env.OPENAI_API_KEY?.trim() ?? "";
}

export function getOpenAiModel() {
  return process.env.OPENAI_MODEL?.trim() || "gpt-5.6-terra";
}

export function isOpenAiConfigured() {
  return getOpenAiApiKey().length > 0;
}

export function getOpenAiSearchModel() {
  // Chat-only models can still write replies while a supported model searches.
  return process.env.OPENAI_SEARCH_MODEL?.trim() || getOpenAiModel();
}

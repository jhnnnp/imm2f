export function getOpenAiApiKey() {
  return process.env.OPENAI_API_KEY?.trim() ?? "";
}

export function getOpenAiModel() {
  return normalizeOpenAiModel(process.env.OPENAI_MODEL) || "gpt-5.6-terra";
}

/** Accept the display labels used in local settings without changing model family. */
export function normalizeOpenAiModel(value: string | undefined) {
  const model = value?.trim() ?? "";
  return /^gpt-\d+(?:\.\d+)?[ -](?:luna|terra|sol|astra)$/i.test(model)
    ? model.toLowerCase().replace(/ /g, "-") : model;
}

export function isOpenAiConfigured() {
  return getOpenAiApiKey().length > 0;
}

export function getOpenAiSearchModel() {
  // Chat-only models can still write replies while a supported model searches.
  return normalizeOpenAiModel(process.env.OPENAI_SEARCH_MODEL) || getOpenAiModel();
}

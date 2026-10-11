import "server-only";

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
  const configured = normalizeOpenAiModel(process.env.OPENAI_SEARCH_MODEL) || getOpenAiModel();
  // These chat models support JSON/function calls, but not the hosted
  // Responses web_search tool. Keep the user's chat model and use a
  // documented search-capable model for this separate operation.
  return /^(?:gpt-4o(?:-mini)?(?:-\d{4}-\d{2}-\d{2})?|gpt-4(?:-turbo)?(?:-[\w-]+)?|gpt-3\.5-turbo(?:-[\w-]+)?|gpt-4\.1-nano(?:-\d{4}-\d{2}-\d{2})?|o1(?:-mini|-preview)?(?:-\d{4}-\d{2}-\d{2})?|o3-mini(?:-\d{4}-\d{2}-\d{2})?)$/i.test(configured)
    ? "gpt-4.1-mini" : configured;
}

export function getKakaoApiKeys() {
  return [process.env.KAKAO_REST_API_KEY, process.env.KAKAO_JAVASCRIPT_KEY]
    .map(value => value?.trim() ?? "")
    .filter((value, index, all) => value.length > 0 && all.indexOf(value) === index);
}

export function getKakaoRestApiKey() {
  return getKakaoApiKeys()[0] ?? "";
}

export function isKakaoConfigured() {
  return getKakaoApiKeys().length > 0;
}

/** Only allow an in-app path, including optional query strings and fragments. */
export function safeNextPath(value: FormDataEntryValue | string | null | undefined) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/";
  if (/[\\\u0000-\u0020\u007f]/.test(value)) return "/";
  try {
    const url = new URL(value, "https://only-us.invalid");
    if (url.origin !== "https://only-us.invalid") return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return "/"; }
}

/** Bound provider outages without allowing aborted reads to restart as retries. */
export const SUPABASE_REQUEST_TIMEOUT_MS = 15_000;
export const SUPABASE_UPLOAD_TIMEOUT_MS = 120_000;

export async function supabaseFetch(input: RequestInfo | URL, init?: RequestInit) {
  const controller = new AbortController();
  const existingSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
  const abort = () => controller.abort(existingSignal?.reason);
  if (existingSignal?.aborted) abort();
  else existingSignal?.addEventListener("abort", abort, { once: true });
  // Photos can be up to 20 MB; upload progress should not share the short
  // deadline used by the queries that determine page loading.
  const uploading = init?.body instanceof Blob || init?.body instanceof FormData;
  const timeout = setTimeout(() => controller.abort(), uploading ? SUPABASE_UPLOAD_TIMEOUT_MS : SUPABASE_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    existingSignal?.removeEventListener("abort", abort);
  }
}

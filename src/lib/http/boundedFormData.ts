export class RequestBodyTooLarge extends Error {}

/** Content-Length is optional and cannot enforce a limit on streamed uploads. */
export async function readBoundedFormData(request: Request, maxBytes: number) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data(?:\s*;|$)/i.test(contentType) || !request.body) throw new Error("invalid_form_data");
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) throw new RequestBodyTooLarge();

  const reader = request.body.getReader();
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]);
  const cancel = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  const parts: ArrayBuffer[] = [];
  let bytes = 0;
  try {
    signal.throwIfAborted();
    while (true) {
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) {
        void reader.cancel().catch(() => {});
        throw new RequestBodyTooLarge();
      }
      parts.push(chunk.value.slice().buffer);
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
  // Parse only the already bounded bytes, never the original unbounded stream.
  return new Request(request.url, {
    method: "POST",
    headers: { "content-type": contentType },
    body: new Blob(parts),
  }).formData();
}

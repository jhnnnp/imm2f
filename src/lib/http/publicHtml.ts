import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

const MAX_BYTES = 1_000_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export function isPublicAddress(value: string): boolean {
  const address = value.toLowerCase().replace(/^\[|\]$/g, "");
  const version = isIP(address);
  if (version === 6) {
    // Only global unicast IPv6. Exclude transition and documentation ranges,
    // which can embed private IPv4 addresses or never identify a public host.
    const [first, second = ""] = address.split(":");
    const range = parseInt(first, 16);
    const subrange = parseInt(second || "0", 16);
    return range >= 0x2000 && range <= 0x3fff
      && !(range === 0x2001 && [0, 0x10, 0x20, 0xdb8].includes(subrange))
      && range !== 0x2002;
  }
  if (version !== 4) return false;
  const [a, b, c] = address.split(".").map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0 && (c === 0 || c === 2))
    || (a === 192 && b === 88 && c === 99)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113));
}

async function beforeDeadline<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export async function resolvePublicUrl(value: string, signal: AbortSignal) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port) throw new Error("invalid_url");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) throw new Error("private_url");
  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await beforeDeadline(lookup(hostname, { all: true }), signal);
  if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) throw new Error("private_url");
  return { url, hostname, address: addresses[0].address };
}

type HtmlResponse = { status: number; location?: string; html: string };

async function requestPinnedHtml(target: Awaited<ReturnType<typeof resolvePublicUrl>>, signal: AbortSignal): Promise<HtmlResponse> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const request = target.url.protocol === "https:" ? httpsRequest : httpRequest;
    // Connect to the exact validated address. Host and SNI still identify the
    // requested website; there is no second DNS lookup that can rebind locally.
    const req = request({
      protocol: target.url.protocol,
      hostname: target.address,
      servername: target.hostname,
      path: `${target.url.pathname}${target.url.search}`,
      signal,
      headers: {
        host: target.url.host,
        accept: "text/html,application/xhtml+xml",
        "accept-encoding": "identity",
        "user-agent": "Mozilla/5.0 (compatible; ONLY-US-LinkPreview/1.0)",
      },
    }, res => {
      const status = res.statusCode ?? 0;
      if (REDIRECT_STATUSES.has(status)) {
        resolve({ status, location: res.headers.location, html: "" });
        res.destroy();
        return;
      }
      if (status < 200 || status >= 300 || !/text\/html|application\/xhtml\+xml/i.test(res.headers["content-type"] ?? "")) {
        reject(new Error("not_html"));
        res.destroy();
        return;
      }
      const buffers: Buffer[] = [];
      let bytes = 0;
      let complete = false;
      const finish = () => {
        if (complete) return;
        complete = true;
        resolve({ status, html: Buffer.concat(buffers).toString("utf8") });
      };
      res.on("data", (chunk: Buffer) => {
        const remaining = MAX_BYTES - bytes;
        const limited = chunk.subarray(0, remaining);
        buffers.push(limited);
        bytes += limited.length;
        if (bytes >= MAX_BYTES) {
          finish();
          res.destroy();
        }
      });
      res.on("end", finish);
      res.on("error", reject);
      res.on("aborted", () => { if (!complete) reject(new Error("incomplete_html")); });
    });
    req.on("error", reject);
    req.end();
  });
}

export async function fetchPublicHtml(value: string, signal = AbortSignal.timeout(8000)) {
  let target = await resolvePublicUrl(value, signal);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const response = await requestPinnedHtml(target, signal);
    if (!REDIRECT_STATUSES.has(response.status)) return { url: target.url, html: response.html };
    if (!response.location || redirects === 3) throw new Error("redirect_limit");
    target = await resolvePublicUrl(new URL(response.location, target.url).toString(), signal);
  }
  throw new Error("redirect_limit");
}

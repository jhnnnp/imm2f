import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_BYTES = 1_000_000;

function isPrivateAddress(address: string) {
  const normalized = address.toLowerCase();
  if (normalized.startsWith("::ffff:")) return isPrivateAddress(normalized.slice(7));
  if (normalized === "::" || normalized === "::1" || normalized.startsWith("fe80:") || normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  const parts = normalized.split(".").map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return false;
  return parts[0] === 10
    || parts[0] === 127
    || parts[0] === 0
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168);
}

async function assertPublicUrl(value: string) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error("invalid_url");
  const addresses = isIP(url.hostname) ? [{ address: url.hostname }] : await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(item => isPrivateAddress(item.address))) throw new Error("private_url");
  return url;
}

async function readLimited(response: Response) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let result = "";
  let bytes = 0;
  while (bytes < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    result += decoder.decode(value, { stream: true });
  }
  await reader.cancel();
  return result;
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function metaContent(html: string, keys: string[]) {
  for (const tag of html.match(/<meta\s[^>]*>/gi) ?? []) {
    const attributes = Object.fromEntries(Array.from(tag.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g), match => [match[1].toLowerCase(), decodeHtml(match[2].trim())]));
    const key = (attributes.property || attributes.name || "").toLowerCase();
    if (keys.includes(key) && attributes.content) return attributes.content;
  }
  return "";
}

export async function GET(request: Request) {
  const requested = new URL(request.url).searchParams.get("url")?.trim();
  if (!requested) return NextResponse.json({ error: "URL이 필요해요." }, { status: 400 });

  try {
    let target = await assertPublicUrl(requested);
    let response: Response | null = null;
    for (let redirects = 0; redirects < 4; redirects += 1) {
      response = await fetch(target, {
        redirect: "manual",
        signal: AbortSignal.timeout(6000),
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": "Mozilla/5.0 (compatible; ONLY-US-LinkPreview/1.0)",
        },
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get("location");
      if (!location) break;
      target = await assertPublicUrl(new URL(location, target).toString());
    }
    if (!response?.ok) throw new Error("fetch_failed");
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) throw new Error("not_html");

    const html = await readLimited(response);
    const rawTitle = metaContent(html, ["og:title", "twitter:title"])
      || decodeHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() ?? "");
    const description = metaContent(html, ["og:description", "twitter:description", "description"]);
    const rawImage = metaContent(html, ["og:image", "twitter:image", "twitter:image:src"]);
    const image = rawImage ? new URL(rawImage, target).toString() : "";

    return NextResponse.json({
      url: target.toString(),
      host: target.hostname.replace(/^www\./, ""),
      title: rawTitle || target.hostname,
      description,
      image,
      siteName: metaContent(html, ["og:site_name"]) || target.hostname.replace(/^www\./, ""),
    }, { headers: { "cache-control": "public, max-age=900, stale-while-revalidate=3600" } });
  } catch {
    return NextResponse.json({ error: "상품 정보를 불러오지 못했어요." }, { status: 422 });
  }
}

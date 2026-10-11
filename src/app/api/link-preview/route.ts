import { NextResponse } from "next/server";
import { getAppSession } from "@/features/auth/session";
import { fetchPublicHtml, resolvePublicUrl } from "@/lib/http/publicHtml";

export const runtime = "nodejs";

function decodeHtml(value: string) {
  const named: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };
  return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (entity, code: string) => {
    if (!code.startsWith("#")) return named[code.toLowerCase()] ?? entity;
    const point = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
      ? String.fromCodePoint(point) : "\ufffd";
  });
}

function metaContent(html: string, keys: string[]) {
  const content = new Map<string, string>();
  for (const tag of html.match(/<meta\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi) ?? []) {
    const attributes = Object.fromEntries(Array.from(tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g), match => [match[1].toLowerCase(), decodeHtml((match[2] ?? match[3] ?? match[4] ?? "").trim())]));
    const key = (attributes.property || attributes.name || "").toLowerCase();
    if (keys.includes(key) && attributes.content && !content.has(key)) content.set(key, attributes.content);
  }
  return keys.map(key => content.get(key)).find(Boolean) ?? "";
}

export async function GET(request: Request) {
  const session = await getAppSession();
  if (session.mode !== "authenticated") return NextResponse.json({ error: "로그인이 필요해요." }, { status: 401 });
  const requested = new URL(request.url).searchParams.get("url")?.trim();
  if (!requested) return NextResponse.json({ error: "URL이 필요해요." }, { status: 400 });
  if (requested.length > 4096) return NextResponse.json({ error: "URL이 너무 길어요." }, { status: 400 });

  try {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(8000)]);
    const fetched = await fetchPublicHtml(requested, signal);
    const target = fetched.url;
    const html = fetched.html.replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
    const rawTitle = metaContent(html, ["og:title", "twitter:title"])
      || decodeHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() ?? "");
    const description = metaContent(html, ["og:description", "twitter:description", "description"]);
    const rawImage = metaContent(html, ["og:image", "twitter:image", "twitter:image:src"]);
    let image = "";
    try {
      const candidate = rawImage ? new URL(rawImage, target) : null;
      if (candidate && candidate.toString().length <= 4096) {
        image = (await resolvePublicUrl(candidate.toString(), signal)).url.toString();
      }
    } catch { /* A malformed image must not hide otherwise valid product details. */ }

    return NextResponse.json({
      url: target.toString(),
      host: target.hostname.replace(/^www\./, ""),
      title: (rawTitle || target.hostname).slice(0, 140),
      description: description.slice(0, 4000),
      image,
      siteName: (metaContent(html, ["og:site_name"]) || target.hostname.replace(/^www\./, "")).slice(0, 140),
    }, { headers: { "cache-control": "private, max-age=900, stale-while-revalidate=3600" } });
  } catch {
    return NextResponse.json({ error: "상품 정보를 불러오지 못했어요." }, { status: 422 });
  }
}

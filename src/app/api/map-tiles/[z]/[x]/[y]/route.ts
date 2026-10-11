import { NextResponse } from "next/server";

export const revalidate = 21600;

export async function GET(request: Request, { params }: { params: Promise<{ z: string; x: string; y: string }> }) {
  const { z, x, y } = await params;
  const values = [z, x, y];
  const [zoom, column, row] = values.map(Number);
  if (!values.every(value => /^\d{1,6}$/.test(value)) || zoom > 14 || column >= 2 ** zoom || row >= 2 ** zoom) {
    return NextResponse.json({ error: "Invalid tile coordinates" }, { status: 400 });
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.signal.addEventListener("abort", abort, { once: true });
  if (request.signal.aborted) abort();
  const timer = setTimeout(abort, 6_000);
  try {
    const response = await fetch(`https://tiles.versatiles.org/tiles/osm/${zoom}/${column}/${row}`, {
      headers: { Accept: "application/vnd.mapbox-vector-tile" },
      signal: controller.signal,
      next: { revalidate: 21600 },
    });
    if (!response.ok) return new NextResponse(null, { status: response.status >= 500 ? 502 : response.status });
    return new NextResponse(await response.arrayBuffer(), {
      headers: {
        "Content-Type": "application/vnd.mapbox-vector-tile",
        "Cache-Control": "public, max-age=21600, s-maxage=21600, stale-while-revalidate=86400",
      },
    });
  } catch {
    return new NextResponse(null, { status: controller.signal.aborted ? 504 : 502 });
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", abort);
  }
}

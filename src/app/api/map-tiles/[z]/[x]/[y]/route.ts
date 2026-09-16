import { NextResponse } from "next/server";

export const revalidate = 21600;

export async function GET(_request: Request, { params }: { params: Promise<{ z: string; x: string; y: string }> }) {
  const { z, x, y } = await params;
  if (![z, x, y].every(value => /^\d+$/.test(value))) {
    return NextResponse.json({ error: "Invalid tile coordinates" }, { status: 400 });
  }

  const response = await fetch(`https://tiles.versatiles.org/tiles/osm/${z}/${x}/${y}`, {
    headers: { Accept: "application/vnd.mapbox-vector-tile" },
    next: { revalidate: 21600 },
  });
  if (!response.ok) return new NextResponse(null, { status: response.status });

  return new NextResponse(await response.arrayBuffer(), {
    headers: {
      "Content-Type": "application/vnd.mapbox-vector-tile",
      "Cache-Control": "public, max-age=21600, s-maxage=21600, stale-while-revalidate=86400",
    },
  });
}

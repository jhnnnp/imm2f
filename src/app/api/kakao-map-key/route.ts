export async function GET() {
  const key = process.env.KAKAO_JAVASCRIPT_KEY?.trim() ?? "";
  return Response.json({ key }, { headers: { "Cache-Control": "private, max-age=300" } });
}

import { loadKoreanHolidays, validHolidayYear } from "@/features/calendar/holidays";

export async function GET(request: Request) {
  const value = new URL(request.url).searchParams.get("year");
  if (!value || !/^\d{4}$/.test(value) || !validHolidayYear(Number(value))) {
    return Response.json({ holidays: [], source: "", status: "unavailable", message: "공휴일을 조회할 연도를 확인해 주세요." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const result = await loadKoreanHolidays(Number(value));
  return Response.json(result, { headers: { "Cache-Control": result.status === "unavailable" ? "no-store" : "public, max-age=1800, stale-while-revalidate=21600" } });
}

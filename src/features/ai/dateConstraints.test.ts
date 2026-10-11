import { describe, expect, it } from "vitest";
import { emptyDateBrief } from "./dateBrief";
import { explicitDateConstraints } from "./dateConstraints";

describe("explicit date constraints", () => {
  const previous = { ...emptyDateBrief(), startTime: "14:00", endTime: "21:00", dateLabel: "2026-10-17" };
  const parse = (message: string) => explicitDateConstraints(message, previous, "2026-10-11");

  it("uses 24-hour notation as written, independent of the previous afternoon meeting", () => {
    expect(parse("내일 10:00부터 18:00까지 성수 데이트")).toMatchObject({ startTime: "10:00", endTime: "18:00", dateLabel: "2026-10-12" });
    expect(parse("오전 10시부터 오후 6시까지")).toMatchObject({ startTime: "10:00", endTime: "18:00" });
    expect(parse("오전 10시부터 6시까지")).toMatchObject({ startTime: "10:00", endTime: "18:00" });
  });

  it("parses a one-field correction without manufacturing the other boundary", () => {
    expect(parse("시작 시간을 16:30로 바꿔줘")).toEqual({ startTime: "16:30", timeWindow: "any" });
    expect(parse("종료 시간을 오후 8시로 앞당겨줘")).toEqual({ endTime: "20:00", timeWindow: "any" });
    expect(parse("오후 세 시에 만나자")).toEqual({ startTime: "15:00", timeWindow: "any" });
    expect(parse("정오부터 시작하자")).toEqual({ startTime: "12:00", timeWindow: "any" });
  });

  it("keeps day-specific travel boundaries out of the global daily time window", () => {
    expect(parse("부산 2박3일, 첫날 오후 7시 도착, 마지막 날 오후 2시 출발")).toEqual({});
    expect(parse("3일차 14:00 출발")).toEqual({});
    expect(parse("현지 출발 14:00")).toEqual({});
  });

  it("does not use venue or performance clocks as a meeting time", () => {
    expect(parse("공연은 19:00이고 카페는 22:00까지 영업해")).toEqual({});
    expect(parse("시작 시간이 16:30이야?")).toEqual({});
  });

  it.each(["총 예산 50,000원 안에서 골라줘", "1인당 하루 5만원", "예산 1.5만원", "예산 제한을 없애줘"])("does not turn budget language into a date constraint: %s", message => {
    expect(parse(message)).toEqual({});
  });

  it("uses a written calendar date and validates the real calendar", () => {
    expect(parse("10월 20일 성수에서 만나자").dateLabel).toBe("2026-10-20");
    expect(parse("2027-02-20으로 날짜 바꿔줘").dateLabel).toBe("2027-02-20");
    expect(parse("10월 20일 말고 10월 21일로 바꿔줘").dateLabel).toBe("2026-10-21");
    expect(parse("2026년 2월 30일로 바꿔줘").dateLabel).toBeUndefined();
    expect(parse("2028년 2월 29일로 바꿔줘").dateLabel).toBe("2028-02-29");
    expect(parse("10월 20일 말고 내일로 바꿔줘").dateLabel).toBe("2026-10-12");
    expect(parse("모레 말고 내일로 바꿔줘").dateLabel).toBe("2026-10-12");
    expect(parse("토요일 말고 일요일로 바꿔줘").dateLabel).toBe("2026-10-11");
  });
});

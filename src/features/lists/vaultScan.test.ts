import { describe, expect, it } from "vitest";
import { normalizeVaultScanItems } from "./vaultScan";

describe("normalizeVaultScanItems", () => {
  it("drops empty titles and duplicates", () => {
    const items = normalizeVaultScanItems({
      items: [
        { title: "기차 A", detail: "10:00", extra: "111" },
        { title: "  ", detail: "x", extra: "y" },
        { title: "기차 A", detail: "10:00", extra: "111" },
        { title: "숙소 B", detail: "2박", extra: "222" },
      ],
    });
    expect(items).toHaveLength(2);
    expect(items[0]?.title).toBe("기차 A");
    expect(items[1]?.title).toBe("숙소 B");
  });

  it("keeps distinct reservation legs with the same number and long common header", () => {
    const header = "동일 예약 기본 정보와 승객 안내\n".repeat(10);
    const items = normalizeVaultScanItems({ items: [
      { title: "왕복 기차", detail: `${header}서울 → 부산 10:00`, extra: "001234" },
      { title: "왕복 기차", detail: `${header}부산 → 서울 18:00`, extra: "001234" },
    ] });
    expect(items).toHaveLength(2);
    expect(items[1].detail).toContain("18:00");
    expect(items[1].extra).toBe("001234");
  });

  it("does not confuse a separator inside a field with an identical reservation", () => {
    expect(normalizeVaultScanItems({ items: [
      { title: "기차|좌석", extra: "123", detail: "출발" },
      { title: "기차", extra: "좌석|123", detail: "출발" },
    ] })).toHaveLength(2);
  });

  it("filters malformed provider fields and bounds the preview", () => {
    const items = normalizeVaultScanItems({ items: [null, 7, { title: 123 }, ...Array.from({ length: 30 }, (_, i) => ({ title: `예약 ${i}`, detail: "메모".repeat(3000), extra: "번호".repeat(3000) }))] });
    expect(items).toHaveLength(15);
    expect(items[0].detail).toHaveLength(4000);
    expect(items[0].extra).toHaveLength(4096);
    expect(normalizeVaultScanItems({ items: "bad" })).toEqual([]);
  });

  it("preserves a long booking URL and an alphanumeric confirmation code", () => {
    const bookingUrl = `https://booking.example/view?confirmation=${"a".repeat(700)}`;
    const items = normalizeVaultScanItems({ items: [
      { title: "항공 예약", extra: "AB0012-CD" },
      { title: "예약 확인", extra: bookingUrl },
    ] });
    expect(items[0].extra).toBe("AB0012-CD");
    expect(items[1].extra).toBe(bookingUrl);
  });
});

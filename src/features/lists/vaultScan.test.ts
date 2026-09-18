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
});

import { describe, expect, it } from "vitest";
import { pairLabel, withAndParticle, withSubjectParticle } from "./koreanName";

describe("korean name particles", () => {
  it("picks 이/가 from the last syllable", () => {
    expect(withSubjectParticle("미나")).toBe("미나가");
    expect(withSubjectParticle("준호")).toBe("준호가");
    expect(withSubjectParticle("진한")).toBe("진한이");
  });

  it("picks 와/과 from the last syllable", () => {
    expect(withAndParticle("미나")).toBe("미나와");
    expect(withAndParticle("준호")).toBe("준호와");
    expect(withAndParticle("진한")).toBe("진한과");
  });

  it("builds a pair label with fallbacks", () => {
    expect(pairLabel("미나", "준호")).toBe("미나 & 준호");
    expect(pairLabel("미나", "  ")).toBe("미나 & 파트너");
  });
});

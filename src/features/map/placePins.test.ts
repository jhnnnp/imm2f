import { describe, expect, it } from "vitest";
import { couplePlacePinFromPartner, couplePlacePinLabel, normalizedPlaceLabel } from "./placePins";
import type { Place } from "@/features/places/types/place";

function place(userStatus: Place["userStatus"], partnerStatus: Place["partnerStatus"]): Pick<Place, "userStatus" | "partnerStatus"> {
  return { userStatus, partnerStatus };
}

describe("couple place pins", () => {
  it("maps saved statuses onto map labels", () => {
    expect(normalizedPlaceLabel("want")).toBe("want");
    expect(normalizedPlaceLabel("must_visit")).toBe("want");
    expect(normalizedPlaceLabel("visited")).toBe("visited");
    expect(normalizedPlaceLabel("revisit")).toBe("revisit");
    expect(normalizedPlaceLabel("neutral")).toBeNull();
    expect(normalizedPlaceLabel("not_interested")).toBeNull();
  });

  it("shows a partner-saved place on my map", () => {
    expect(couplePlacePinLabel(place("neutral", "want"))).toBe("want");
    expect(couplePlacePinFromPartner(place("neutral", "want"))).toBe(true);
  });

  it("keeps my own status when both people saved the place", () => {
    expect(couplePlacePinLabel(place("visited", "want"))).toBe("visited");
    expect(couplePlacePinFromPartner(place("visited", "want"))).toBe(false);
  });

  it("hides places neither of us marked", () => {
    expect(couplePlacePinLabel(place("neutral", "neutral"))).toBeNull();
    expect(couplePlacePinLabel(place("dislike", "not_interested"))).toBeNull();
  });
});

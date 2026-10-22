import { expect, it } from "vitest";
import { parseCoupleKeyDates } from "./keyDates";
const birthday = { id: "d9e5de9c-55b8-48bb-8d91-aa948c35b3d0", name: "첫 사람", date: "2000-02-29" };
it("preserves explicit labels and permanent IDs without swapping partners by viewer order", () => {
  const dates = { relationshipStartedOn: "2020-01-01", birthdays: [birthday,
    { id: "2aa03a96-e03b-4cef-aab0-108cf64ba955", name: "두 번째 사람", date: "2001-03-02" }] };
  expect(parseCoupleKeyDates(dates, "2026-10-22")).toEqual(dates);
  expect(parseCoupleKeyDates({ relationshipStartedOn: null, birthdays: [] })).toEqual({ relationshipStartedOn: null, birthdays: [] });
});
it.each([
  { relationshipStartedOn: "2026-02-30", birthdays: [] },
  { relationshipStartedOn: "2027-01-01", birthdays: [] },
  { relationshipStartedOn: null, birthdays: [{ ...birthday, date: "2001-02-29" }] },
  { relationshipStartedOn: null, birthdays: [{ ...birthday, date: "2027-01-01" }] },
  { relationshipStartedOn: null, birthdays: [{ ...birthday, id: "person-1" }] },
  { relationshipStartedOn: null, birthdays: [{ ...birthday, name: " " }] },
  { relationshipStartedOn: null, birthdays: [birthday, birthday] },
  { relationshipStartedOn: null, birthdays: [birthday, birthday, birthday] },
])("rejects invalid or ambiguous persisted dates %j", dates => {
  expect(parseCoupleKeyDates(dates, "2026-10-22")).toBeNull();
});

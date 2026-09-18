import { completeJsonFromImage } from "./client";
import { normalizeVaultScanItems, type VaultScanItemDraft } from "@/features/lists/vaultScan";

const SYSTEM = `You extract travel reservation details from Korean travel-app screenshots (Modu tour, Korail, hotel apps, etc.).
Return one JSON object only: { "items": [ { "title", "detail", "extra" } ] }.

Rules:
- Split into separate items for each distinct reservation leg (hotel stay, each train segment, each flight, rental car, etc.).
- Same reservation number on round-trip trains still becomes two items if route/date/time differ.
- title: short Korean label including place or route and date (example: "기차 용산 → 군산 (9/20)", "군산 브라운도트 (9/20~22)").
- detail: multiline facts — times, train name/number, car/seat, guests, cancel policy, check-in/out, room type. Copy text faithfully from the image.
- extra: reservation or confirmation number only (digits), or a URL if shown. No prose.
- Omit items you cannot read. Never invent numbers or times.
- If the image has no reservations, return { "items": [] }.`;

type RawPayload = { items?: Array<{ title?: string; detail?: string; extra?: string }> };

export async function parseVaultReservationsFromScreenshot(imageDataUrl: string): Promise<VaultScanItemDraft[]> {
  const parsed = await completeJsonFromImage<RawPayload>({
    instructions: SYSTEM,
    imageDataUrl,
    maxTokens: 4000,
    timeoutMs: 45000,
  });
  return normalizeVaultScanItems(parsed);
}

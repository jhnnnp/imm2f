import { loadEnvConfig } from "@next/env";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { searchKakaoKeyword } from "@/lib/kakao/local";
import { findKopisPerformances } from "./client";
import { candidateActivitySlot } from "@/features/ai/dateCourse";

const live = process.env.LIVE_KOPIS === "1";
if (live) {
  loadEnvConfig(process.cwd());
  // Next's test mode intentionally ignores .env.local; this opt-in test needs
  // the locally configured provider key without ever printing it.
  const local = readFileSync(".env.local", "utf8");
  process.env.KOPIS_SERVICE_KEY ||= local.match(/^KOPIS_SERVICE_KEY=([^\r\n]+)/m)?.[1];
}

it.skipIf(!live)("resolves a real dated performance to the exact Kakao venue", async () => {
  const result = await searchKakaoKeyword("소월아트홀");
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const venue = result.places.find(place => place.name === "소월아트홀");
  expect(venue).toBeTruthy();
  if (!venue) return;
  const events = await findKopisPerformances(venue, "20261009");
  console.info("kopis_live_match", { coordinates: venue.coordinates, slot: candidateActivitySlot(venue), events: events.map(event => ({ id: event.id, showtimes: event.showtimes })) });
  expect(events.some(event => event.id === "PF297542" && event.showtimes.includes("19:00"))).toBe(true);
}, 30000);

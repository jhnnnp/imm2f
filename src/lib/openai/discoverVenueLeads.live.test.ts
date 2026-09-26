import { loadEnvConfig } from "@next/env";
import { expect, it } from "vitest";
import { emptyDateBrief, withAreas } from "@/features/ai/dateBrief";
import { searchKakaoKeyword } from "@/lib/kakao/local";
import { discoverVenueLeads, leadMatchesCandidate } from "./discoverVenueLeads";

const live = process.env.LIVE_VENUE_LEADS === "1";
if (live) loadEnvConfig(process.cwd());

it.skipIf(!live)("finds cited cafe leads that resolve to real map places", async () => {
  const state = withAreas(emptyDateBrief(), ["왕십리"]);
  state.activities = ["cafe"];
  state.userRequests = ["왕십리에서 공간이 예쁜 카페 데이트"];
  state.discovery = {
    themes: ["공간이 돋보이는 카페"], priorities: ["인테리어가 독특한 카페", "공간 분위기"],
    queries: [], transport: "walk", requiredActivities: ["cafe"], activityOrder: [], minStops: 2, maxStops: 3,
  };
  const leads = await discoverVenueLeads(state);
  const results = await Promise.all(leads.map(lead => searchKakaoKeyword(`${lead.name} ${lead.region}`)));
  const resolved = leads.filter((lead, index) => results[index].ok
    && results[index].places.some(candidate => leadMatchesCandidate(lead, candidate)));
  console.info("venue_leads_live", { proposed: leads.length, resolved: resolved.length, names: resolved.map(lead => lead.name) });
  expect(resolved.length, "Cited web leads must resolve to exact map venues").toBeGreaterThan(0);
}, 45000);

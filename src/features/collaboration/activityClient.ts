"use client";

import { loadCoupleActivities } from "./actions";
import type { CoupleActivity } from "./types";

const requests = new Map<number, Promise<CoupleActivity[]>>();

export function preloadCoupleActivities(limit = 20, refresh = false) {
  if (refresh || !requests.has(limit)) {
    requests.set(limit, loadCoupleActivities(limit).catch(error => {
      requests.delete(limit);
      throw error;
    }));
  }
  return requests.get(limit)!;
}

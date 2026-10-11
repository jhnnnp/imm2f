import type { WorkspaceChange } from "./realtimeSync";

export type SharedRefreshOptions = {
  tables?: readonly string[];
  activityPrefixes?: readonly string[];
  pollIntervalMs?: number;
  refreshOnConnect?: boolean;
};

export function isRelevantWorkspaceChange(change: WorkspaceChange, options: SharedRefreshOptions) {
  if (change.source !== "database") return true;
  // Activities announce domain writes. Wall drawing has its own consumer and
  // should not cause an unrelated planner to fetch its entire workspace.
  if (change.table !== "activities") return options.tables?.includes(change.table) ?? false;
  const action = typeof change.row.action === "string" ? change.row.action : "";
  if (!action) return true;
  return !options.activityPrefixes || options.activityPrefixes.some(prefix => action.startsWith(prefix));
}

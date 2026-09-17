import { ActivityPanel } from "./ActivityPanel";
import { loadCoupleActivities } from "../actions";

export async function ActivityPanelServer() {
  const activities = await loadCoupleActivities(8);
  return <ActivityPanel initialItems={activities} />;
}

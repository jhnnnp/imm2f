export function candidateExplorationMode(): "active" | "off" {
  return process.env.DATE_CANDIDATE_EXPLORATION_MODE?.trim().toLowerCase() === "off"
    ? "off" : "active";
}

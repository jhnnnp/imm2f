import type { Memory } from "./types";

/** Compare editable content without signed URLs or presentation-only photo data. */
export function memoryEditSnapshot(memory: Pick<Memory, "title" | "happenedOn" | "description" | "locationLabel" | "memoryType" | "coordinates">) {
  return JSON.stringify([memory.title, memory.happenedOn, memory.description, memory.locationLabel, memory.memoryType, memory.coordinates]);
}

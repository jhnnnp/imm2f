/**
 * V1.5 extension point.
 * MapLibre owns projection, camera and WebGL lifecycle. Three.js will render
 * memory objects only through a CustomLayerInterface implementation here.
 */
export type MemoryObjectKind = "memory_pin" | "anniversary_pin" | "route_glow";

export const THREE_LAYER_ID = "only-us-memory-objects";

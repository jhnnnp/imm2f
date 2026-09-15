export type MemoryType = "free" | "trip" | "date";

export type MemoryPhoto = {
  id: string;
  storageUrl: string;
  caption: string;
  sortOrder: number;
  latitude: number | null;
  longitude: number | null;
};

export type Memory = {
  id: string;
  memoryType: MemoryType;
  placeId: string | null;
  title: string;
  happenedOn: string;
  description: string;
  locationLabel: string;
  coordinates: [number, number] | null;
  createdBy: string | null;
  createdAt: string;
  coverUrl: string | null;
  photos: MemoryPhoto[];
};

export type CreateMemoryInput = {
  title: string;
  happenedOn: string;
  description: string;
  locationLabel: string;
  memoryType?: MemoryType;
  placeId?: string | null;
  coverUrl?: string;
  lng?: number | null;
  lat?: number | null;
};

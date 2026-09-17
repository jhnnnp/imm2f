export type MemoryType = "free" | "trip" | "date";

export type MemoryPhoto = {
  id: string;
  storageUrl: string;
  caption: string;
  sortOrder: number;
  latitude: number | null;
  longitude: number | null;
  capturedAt: string | null;
  originalFilename: string;
  mimeType: string;
  fileSize: number | null;
  width: number | null;
  height: number | null;
  cameraMake: string;
  cameraModel: string;
  locationSource: "none" | "exif" | "place" | "manual";
};

export type PhotoMetadataInput = {
  storagePath?: string | null;
  originalFilename?: string;
  mimeType?: string;
  fileSize?: number | null;
  width?: number | null;
  height?: number | null;
  capturedAt?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  cameraMake?: string;
  cameraModel?: string;
  orientation?: number | null;
  locationSource?: "none" | "exif" | "place" | "manual";
  metadata?: Record<string, string | number | boolean | null>;
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
  photo?: PhotoMetadataInput;
  lng?: number | null;
  lat?: number | null;
};

export type UpdateMemoryInput = {
  id: string;
  title: string;
  happenedOn: string;
  description: string;
  locationLabel: string;
  memoryType: MemoryType;
  lng: number | null;
  lat: number | null;
  coverUrl?: string;
  photo?: PhotoMetadataInput;
};

import type { PhotoMetadataInput } from "./types";

export async function inspectMemoryPhoto(file: File): Promise<PhotoMetadataInput> {
  try {
    const [{ parse }, bitmap] = await Promise.all([
      import("exifr"),
      createImageBitmap(file).catch(() => null),
    ]);
    const exif = await parse(file, [
      "DateTimeOriginal", "CreateDate", "GPSLatitude", "GPSLongitude", "latitude", "longitude",
      "Make", "Model", "LensModel", "Orientation", "Software",
    ]).catch(() => null) as Record<string, unknown> | null;
    const lat = Number(exif?.latitude ?? exif?.GPSLatitude);
    const lng = Number(exif?.longitude ?? exif?.GPSLongitude);
    const captured = exif?.DateTimeOriginal ?? exif?.CreateDate;
    const capturedDate = captured instanceof Date ? captured : captured ? new Date(String(captured)) : null;
    const hasCoordinates = Number.isFinite(lat) && Number.isFinite(lng);
    const width = bitmap?.width ?? null;
    const height = bitmap?.height ?? null;
    bitmap?.close();
    return {
      originalFilename: file.name,
      mimeType: file.type || "application/octet-stream",
      fileSize: file.size,
      width,
      height,
      capturedAt: capturedDate && !Number.isNaN(capturedDate.getTime()) ? capturedDate.toISOString() : null,
      latitude: hasCoordinates ? lat : null,
      longitude: hasCoordinates ? lng : null,
      cameraMake: String(exif?.Make ?? ""),
      cameraModel: String(exif?.Model ?? ""),
      orientation: Number.isFinite(Number(exif?.Orientation)) ? Number(exif?.Orientation) : null,
      locationSource: hasCoordinates ? "exif" : "none",
      metadata: {
        lens: String(exif?.LensModel ?? ""),
        software: String(exif?.Software ?? ""),
      },
    };
  } catch {
    return {
      originalFilename: file.name,
      mimeType: file.type || "application/octet-stream",
      fileSize: file.size,
    };
  }
}

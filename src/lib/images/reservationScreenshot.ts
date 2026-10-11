import sharp from "sharp";

const MAX_PIXELS = 20_000_000;
const MAX_DIMENSION = 8192;
const MIME_BY_FORMAT: Record<string, string> = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

export class InvalidReservationScreenshot extends Error {
  constructor(public readonly kind: "type" | "size" | "corrupt") { super(kind); }
}

function sniffFormat(buffer: Buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpeg";
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
}

/** Verify bytes and decode locally before any paid image request is made. */
export async function validateReservationScreenshot(buffer: Buffer, declaredMime: string) {
  const format = sniffFormat(buffer);
  if (!format || (declaredMime && declaredMime !== MIME_BY_FORMAT[format])) throw new InvalidReservationScreenshot("type");
  try {
    const metadata = await sharp(buffer, { limitInputPixels: false, failOn: "warning" }).metadata();
    if (metadata.format !== format || (metadata.pages ?? 1) !== 1) throw new InvalidReservationScreenshot("type");
    if (!metadata.width || !metadata.height || metadata.width > MAX_DIMENSION || metadata.height > MAX_DIMENSION
      || metadata.width * metadata.height > MAX_PIXELS) throw new InvalidReservationScreenshot("size");
    // Metadata alone also accepts truncated files. stats() decodes all pixels
    // without changing the screenshot or reducing the text's OCR quality.
    await sharp(buffer, { limitInputPixels: MAX_PIXELS, failOn: "warning" }).stats();
    return MIME_BY_FORMAT[format];
  } catch (error) {
    if (error instanceof InvalidReservationScreenshot) throw error;
    throw new InvalidReservationScreenshot("corrupt");
  }
}

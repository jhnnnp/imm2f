export type WallTextFont = "hand" | "sans";
export type WallTextWeight = "normal" | "bold";

export type WallText = {
  id: string;
  authorId?: string;
  x: number;
  y: number;
  z: number;
  text: string;
  color: string;
  fontFamily: WallTextFont;
  fontWeight: WallTextWeight;
  fontSize: number;
  rotation: number;
};

export const WALL_TEXT_SIZES = [18, 24, 32, 42] as const;

export function createWallText(input: Partial<WallText> & { x: number; y: number }): WallText {
  return {
    id: crypto.randomUUID(),
    authorId: input.authorId,
    x: input.x,
    y: input.y,
    z: input.z ?? 40,
    text: input.text?.trim() ?? "",
    color: input.color ?? "#2b312e",
    fontFamily: input.fontFamily ?? "hand",
    fontWeight: input.fontWeight ?? "normal",
    fontSize: input.fontSize ?? 28,
    rotation: input.rotation ?? 0,
  };
}

export function parseWallTexts(raw: unknown): WallText[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const x = Number(record.x);
    const y = Number(record.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
    const fontFamily = record.fontFamily === "sans" ? "sans" : "hand";
    const fontWeight = record.fontWeight === "bold" ? "bold" : "normal";
    const fontSize = Number(record.fontSize);
    return [{
      id: String(record.id ?? crypto.randomUUID()),
      authorId: typeof record.authorId === "string" ? record.authorId : undefined,
      x,
      y,
      z: Number.isFinite(Number(record.z)) ? Number(record.z) : 40,
      text: String(record.text ?? "").slice(0, 280),
      color: String(record.color ?? "#2b312e"),
      fontFamily,
      fontWeight,
      fontSize: Number.isFinite(fontSize) ? Math.max(14, Math.min(64, fontSize)) : 28,
      rotation: Number.isFinite(Number(record.rotation)) ? Number(record.rotation) : 0,
    }];
  });
}

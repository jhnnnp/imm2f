import { NextResponse } from "next/server";
import { getAppSession } from "@/features/auth/session";
import { isOpenAiConfigured } from "@/lib/openai/env";
import { parseVaultReservationsFromScreenshot } from "@/lib/openai/parseVaultScreenshot";
import { readBoundedFormData, RequestBodyTooLarge } from "@/lib/http/boundedFormData";
import { InvalidReservationScreenshot, validateReservationScreenshot } from "@/lib/images/reservationScreenshot";

export const runtime = "nodejs";

const MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(request: Request) {
  const session = await getAppSession();
  if (session.mode !== "authenticated") {
    return NextResponse.json({ error: "로그인 후 사용할 수 있어요." }, { status: 401 });
  }
  if (!isOpenAiConfigured()) {
    return NextResponse.json({ error: "예약 읽기 기능을 아직 준비하지 못했어요. 잠시 후 다시 시도해 주세요." }, { status: 503 });
  }

  let form: FormData;
  try {
    form = await readBoundedFormData(request, MAX_BYTES + 64 * 1024);
  } catch (error) {
    if (error instanceof RequestBodyTooLarge) return NextResponse.json({ error: "이미지는 4MB 이하로 올려 주세요." }, { status: 413 });
    return NextResponse.json({ error: "이미지를 받지 못했어요." }, { status: 400 });
  }

  const file = form.get("image");
  if (!(file instanceof File) || file.size <= 0 || form.getAll("image").length !== 1) {
    return NextResponse.json({ error: "스크린샷 파일을 선택해 주세요." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "이미지는 4MB 이하로 올려 주세요." }, { status: 400 });
  }

  // Multipart encoders use octet-stream when the original file has no MIME.
  // In that case the actual image bytes below determine the allowed format.
  const declaredMime = file.type === "application/octet-stream" ? "" : file.type;
  if (declaredMime && !ALLOWED.has(declaredMime)) {
    return NextResponse.json({ error: "JPEG, PNG, WebP 이미지만 올릴 수 있어요." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  let mime: string;
  try {
    mime = await validateReservationScreenshot(buffer, declaredMime);
  } catch (error) {
    const message = error instanceof InvalidReservationScreenshot && error.kind === "size"
      ? "이미지가 너무 커요. 예약 부분을 잘라 다시 올려 주세요."
      : "읽을 수 있는 JPEG, PNG, WebP 스크린샷으로 다시 올려 주세요.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
  if (request.signal.aborted) return NextResponse.json({ error: "이미지 읽기가 취소됐어요." }, { status: 400 });
  const dataUrl = `data:${mime};base64,${buffer.toString("base64")}`;
  let items;
  try {
    items = await parseVaultReservationsFromScreenshot(dataUrl, request.signal);
  } catch {
    if (request.signal.aborted) return NextResponse.json({ error: "이미지 읽기가 취소됐어요." }, { status: 400 });
    return NextResponse.json({ error: "예약 정보를 읽지 못했어요. 잠시 후 다시 시도해 주세요." }, { status: 502 });
  }

  if (!items.length) {
    return NextResponse.json({ error: "예약 정보를 찾지 못했어요. 더 선명한 스크린샷으로 다시 시도해 주세요." }, { status: 422 });
  }

  return NextResponse.json({ items });
}

import { NextResponse } from "next/server";
import { getAppSession } from "@/features/auth/session";
import { isOpenAiConfigured } from "@/lib/openai/env";
import { parseVaultReservationsFromScreenshot } from "@/lib/openai/parseVaultScreenshot";

export const runtime = "nodejs";

const MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(request: Request) {
  const session = await getAppSession();
  if (session.mode !== "authenticated") {
    return NextResponse.json({ error: "로그인 후 사용할 수 있어요." }, { status: 401 });
  }
  if (!isOpenAiConfigured()) {
    return NextResponse.json({ error: "예약 읽기 기능을 쓰려면 서버에 OPENAI_API_KEY가 필요해요." }, { status: 503 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "이미지를 받지 못했어요." }, { status: 400 });
  }

  const file = form.get("image");
  if (!(file instanceof File) || file.size <= 0) {
    return NextResponse.json({ error: "스크린샷 파일을 선택해 주세요." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "이미지는 4MB 이하로 올려 주세요." }, { status: 400 });
  }

  const mime = file.type || "image/jpeg";
  if (!ALLOWED.has(mime)) {
    return NextResponse.json({ error: "JPEG, PNG, WebP 이미지만 올릴 수 있어요." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const dataUrl = `data:${mime};base64,${buffer.toString("base64")}`;
  const items = await parseVaultReservationsFromScreenshot(dataUrl);

  if (!items.length) {
    return NextResponse.json({ error: "예약 정보를 찾지 못했어요. 더 선명한 스크린샷으로 다시 시도해 주세요." }, { status: 422 });
  }

  return NextResponse.json({ items });
}

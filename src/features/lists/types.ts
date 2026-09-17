export type NoteKind = "vault" | "gift" | "bucket";

export type CoupleNote = {
  id: string;
  kind: NoteKind;
  title: string;
  detail: string;
  status: string;
  extra: string;
  createdAt: string;
  createdBy?: string;
};

export const NOTE_STATUS: Record<NoteKind, ReadonlyArray<{ id: string; label: string }>> = {
  vault: [
    { id: "kept", label: "보관 중" },
    { id: "used", label: "사용 완료" },
    { id: "archived", label: "보관 종료" },
  ],
  gift: [
    { id: "idea", label: "생각 중" },
    { id: "ready", label: "준비 중" },
    { id: "given", label: "전달 완료" },
  ],
  bucket: [
    { id: "wish", label: "하고 싶어요" },
    { id: "planning", label: "계획 중" },
    { id: "done", label: "완료" },
  ],
};

export const NOTE_COPY: Record<NoteKind, { eyebrow: string; title: string; lead: string; placeholder: string; extra: string; extraPh: string }> = {
  vault: {
    eyebrow: "VAULT",
    title: "둘만 아는 보관함",
    lead: "예약 번호, 편지, 두고 싶은 말을 여기에 모아 둬요.",
    placeholder: "제주 렌터카 예약번호",
    extra: "코드 / 링크",
    extraPh: "예약 확인 번호나 URL",
  },
  gift: {
    eyebrow: "GIFTS",
    title: "마음을 준비하는 선물",
    lead: "주고 싶은 마음부터 전한 순간까지, 둘의 선물 기록을 차곡차곡 관리해요.",
    placeholder: "손편지와 작은 꽃",
    extra: "상품 링크",
    extraPh: "https://example.com/product",
  },
  bucket: {
    eyebrow: "BUCKET",
    title: "언젠가 꼭, 우리",
    lead: "가고 싶은 곳과 해보고 싶은 일을 천천히 쌓아 가요.",
    placeholder: "비 오는 날 포장마차",
    extra: "메모",
    extraPh: "올해 안에, 둘이서",
  },
};

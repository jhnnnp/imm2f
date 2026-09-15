export type NoteKind = "vault" | "gift" | "bucket";

export type CoupleNote = {
  id: string;
  kind: NoteKind;
  title: string;
  detail: string;
  status: string;
  extra: string;
  createdAt: string;
};

export const NOTE_STATUS: Record<NoteKind, ReadonlyArray<{ id: string; label: string }>> = {
  vault: [
    { id: "kept", label: "보관 중" },
    { id: "used", label: "썼어요" },
    { id: "archived", label: "지나감" },
  ],
  gift: [
    { id: "idea", label: "아이디어" },
    { id: "ready", label: "준비됨" },
    { id: "given", label: "전했어요" },
  ],
  bucket: [
    { id: "wish", label: "언젠가" },
    { id: "planning", label: "준비 중" },
    { id: "done", label: "해냈어요" },
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
    title: "아직 비밀인 선물",
    lead: "주고 싶은 것과 준비 상태를 적어 두면, 깜빡하지 않아요.",
    placeholder: "손편지와 작은 꽃",
    extra: "누구를 위해",
    extraPh: "지은 / 둘 다",
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

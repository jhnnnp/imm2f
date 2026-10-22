import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { NotesContextPanel } from "./NotesContextPanel";
import type { CoupleNote } from "../types";

it("shows the newest created record after manual reordering changes the first row", () => {
  const notes: CoupleNote[] = [
    { id: "old", kind: "bucket", title: "이전 기록", detail: "", status: "done", extra: "", createdAt: "2026-09-01T00:00:00Z" },
    { id: "new", kind: "bucket", title: "최근에 추가한 기록", detail: "", status: "wish", extra: "", createdAt: "2026-10-22T00:00:00Z" },
  ];
  const html = renderToStaticMarkup(createElement(NotesContextPanel, { kind: "bucket", notes }));
  expect(html).toContain("최근에 추가한 기록");
  expect(html).not.toContain("이전 기록");
  expect(html).toContain("총 2개");
  expect(html).toContain('href="/memories"');
});
it("keeps an empty shared list useful without inventing a latest record", () => {
  const html = renderToStaticMarkup(createElement(NotesContextPanel, { kind: "vault", notes: [] }));
  expect(html).not.toContain("최근 기록");
  expect(html).toContain("총 0개");
  expect(html).toContain('href="/trip"');
});

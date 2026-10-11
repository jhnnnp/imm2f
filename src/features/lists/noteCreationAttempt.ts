import type { NoteKind } from "./types";

export type NoteCreationAttempt = { id: string; key: string };
export type NoteCreationInput = { title: string; detail: string; extra: string; status?: string; attemptId?: string };

export function isNoteCreationAttemptId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/** An unchanged draft keeps its identity after a lost response. */
export function noteCreationAttempt(previous: NoteCreationAttempt | null, kind: NoteKind, input: NoteCreationInput, makeId: () => string = () => crypto.randomUUID()): NoteCreationAttempt {
  const key = JSON.stringify([kind, input.title.trim(), input.detail.trim(), input.extra.trim(), input.status ?? ""]);
  return previous?.key === key ? previous : { id: makeId(), key };
}

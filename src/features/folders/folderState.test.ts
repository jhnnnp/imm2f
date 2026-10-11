import { expect, it } from "vitest";
import { moveMemberships, readFolderDrop, validFolderInput } from "./folderState";
import type { FolderWorkspace } from "./types";

it("accepts names within the shared limit and rejects control characters and unsupported colors", () => {
  expect(validFolderInput({ name: "  부산의 가을  ", color: "sage" })).toBe(true);
  for (const name of ["", "  ", "a".repeat(41), "우리\n여행", "이름\u0000"]) expect(validFolderInput({ name, color: "sage" })).toBe(false);
  expect(validFolderInput({ name: "여행", color: "red" })).toBe(false);
  expect(validFolderInput(null)).toBe(false);
});
it("moves only selected memberships and keeps other records intact", () => {
  const before: FolderWorkspace = { persist: true, folders: [], memberships: [{ itemId: "a", folderId: "one" }, { itemId: "b", folderId: "one" }] };
  expect(moveMemberships(before, ["a", "a"], "two").memberships).toEqual([{ itemId: "b", folderId: "one" }, { itemId: "a", folderId: "two" }]);
  expect(moveMemberships(before, ["a"], null).memberships).toEqual([{ itemId: "b", folderId: "one" }]);
  expect(before.memberships).toHaveLength(2);
});
it("accepts only existing same-scope drag payloads, without partial acceptance", () => {
  const items = new Set(["a", "b"]);
  expect(readFolderDrop(JSON.stringify({ scope: "places", ids: ["a", "a", "b"] }), "places", items)).toEqual(["a", "b"]);
  for (const payload of ["{", "null", JSON.stringify({ scope: "vault", ids: ["a"] }), JSON.stringify({ scope: "places", ids: ["a", "foreign"] }), JSON.stringify({ scope: "places", ids: [] }), JSON.stringify({ scope: "places", ids: Array(501).fill("a") }), " ".repeat(40_001)]) expect(readFolderDrop(payload, "places", items)).toEqual([]);
});

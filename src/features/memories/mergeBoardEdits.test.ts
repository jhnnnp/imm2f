import { describe, expect, it } from "vitest";
import { emptyBoardState } from "./corkLayout";
import { createWallText } from "./wallText";
import { mergeBoardEdits } from "./mergeBoardEdits";

describe("concurrent wall edits", () => {
  it("keeps both partners' independent text and photo changes", () => {
    const base = emptyBoardState();
    const mine = createWallText({ x: 10, y: 20, text: "진한" });
    const theirs = createWallText({ x: 30, y: 40, text: "현정" });
    const local = { ...base, texts: [mine] };
    const remote = { ...base, texts: [theirs], poses: { photo: { x: 1, y: 2, z: 3, r: 0 } } };
    const merged = mergeBoardEdits(base, local, remote);
    expect(merged.texts.map(item => item.text)).toEqual(["현정", "진한"]);
    expect(merged.poses).toEqual(remote.poses);
  });
  it("does not resurrect a remote deletion during unrelated edits", () => {
    const text = createWallText({ x: 1, y: 2, text: "지울 글" });
    const base = { ...emptyBoardState(), texts: [text] };
    const local = { ...base, poses: { photo: { x: 1, y: 2, z: 3, r: 0 } } };
    expect(mergeBoardEdits(base, local, emptyBoardState()).texts).toEqual([]);
  });
  it("applies a local deletion without dropping a partner's addition", () => {
    const old = createWallText({ x: 1, y: 2 });
    const added = createWallText({ x: 1, y: 2, text: "새 글" });
    const base = { ...emptyBoardState(), texts: [old] };
    expect(mergeBoardEdits(base, emptyBoardState(), { ...base, texts: [old, added] }).texts).toEqual([added]);
  });
  it("rebases edits made while a save was in flight", () => {
    const text = createWallText({ x: 1, y: 2, text: "처음" });
    const sent = { ...emptyBoardState(), texts: [text] };
    const local = { ...sent, texts: [{ ...text, text: "나중" }] };
    const remote = { ...sent, poses: { photo: { x: 1, y: 2, z: 3, r: 0 } } };
    const result = mergeBoardEdits(sent, local, remote);
    expect(result.texts[0].text).toBe("나중");
    expect(result.poses).toEqual(remote.poses);
  });
});

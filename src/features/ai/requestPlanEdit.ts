import { proposePlanEdits } from "./actions";

/** Transport failures must release the editor, and obsolete proposals must not
 * overwrite the mode or conversation the user switched to while waiting. */
export async function requestPlanEdit(input: Parameters<typeof proposePlanEdits>[0], isCurrent: () => boolean) {
  try {
    const result = await proposePlanEdits(input);
    return isCurrent() ? result : null;
  } catch {
    return isCurrent() ? { error: "변경안을 가져오지 못했어요. 요청 내용은 남아 있으니 다시 시도해 주세요." } : null;
  }
}

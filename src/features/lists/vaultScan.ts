export type VaultScanItemDraft = {
  title: string;
  detail: string;
  extra: string;
};

export type VaultScanResponse = {
  items: VaultScanItemDraft[];
};

const MAX_ITEMS = 15;
const MAX_TITLE = 140;
const MAX_DETAIL = 4000;
const MAX_EXTRA = 4096;

function trimField(value: unknown, max: number) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

export function normalizeVaultScanItems(raw: unknown): VaultScanItemDraft[] {
  if (!raw || typeof raw !== "object") return [];
  const items = (raw as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];

  const seen = new Set<string>();
  const next: VaultScanItemDraft[] = [];

  for (const entry of items) {
    if (!entry || typeof entry !== "object") continue;
    const title = trimField((entry as { title?: unknown }).title, MAX_TITLE);
    if (!title) continue;
    const detail = trimField((entry as { detail?: unknown }).detail, MAX_DETAIL);
    const extra = trimField((entry as { extra?: unknown }).extra, MAX_EXTRA);
    // Shared reservation numbers and long common headers still identify
    // different legs when their route or departure time differs later on.
    const key = JSON.stringify([title, extra, detail]);
    if (seen.has(key)) continue;
    seen.add(key);
    next.push({ title, detail, extra });
    if (next.length >= MAX_ITEMS) break;
  }

  return next;
}

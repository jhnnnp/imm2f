import type { PhotoMetadataInput } from "./types";

type InspectionDraft = { key: string; file: File };

/** Removed photos and closed editors must not receive late EXIF results. */
export function createPhotoDraftLifecycle() {
  const active = new Set<string>();
  return {
    add(keys: readonly string[]) { keys.forEach(key => active.add(key)); },
    remove(key: string) { active.delete(key); },
    clear() { active.clear(); },
    async inspect(
      drafts: readonly InspectionDraft[],
      read: (file: File) => Promise<PhotoMetadataInput>,
      apply: (draft: InspectionDraft, metadata: PhotoMetadataInput, index: number) => void,
    ) {
      await Promise.all(drafts.map(async (draft, index) => {
        const metadata = await read(draft.file);
        if (active.has(draft.key)) apply(draft, metadata, index);
      }));
    },
  };
}

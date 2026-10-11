import type { Metadata } from "next";
import { RouteSuspense } from "@/components/layout/RouteSuspense";
import { CoupleNotesBoard } from "@/features/lists/components/CoupleNotesBoard";
import { NotesContextPanel } from "@/features/lists/components/NotesContextPanel";
import { ContextPanel } from "@/components/layout/ContextPanel";
import { listNotes } from "@/features/lists/actions";
import { listFolderWorkspace } from "@/features/folders/actions";

export const metadata: Metadata = { title: "우리의 보관함" };

export default function VaultPage() {
  return (
    <RouteSuspense>
      <VaultPageContent />
    </RouteSuspense>
  );
}

async function VaultPageContent() {
  const [{ notes, persist }, folderWorkspace] = await Promise.all([
    listNotes("vault"),
    listFolderWorkspace("vault"),
  ]);
  return (
    <>
      <ContextPanel>
        <NotesContextPanel kind="vault" notes={notes} />
      </ContextPanel>
      <CoupleNotesBoard kind="vault" initialNotes={notes} persist={persist} initialFolderWorkspace={folderWorkspace} />
    </>
  );
}

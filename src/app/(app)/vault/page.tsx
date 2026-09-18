import { RouteSuspense } from "@/components/layout/RouteSuspense";
import { CoupleNotesBoard } from "@/features/lists/components/CoupleNotesBoard";
import { NotesContextPanel } from "@/features/lists/components/NotesContextPanel";
import { ContextPanel } from "@/components/layout/ContextPanel";
import { listNotes } from "@/features/lists/actions";

export default function VaultPage() {
  return (
    <RouteSuspense>
      <VaultPageContent />
    </RouteSuspense>
  );
}

async function VaultPageContent() {
  const { notes, persist } = await listNotes("vault");
  return (
    <>
      <ContextPanel>
        <NotesContextPanel kind="vault" notes={notes} />
      </ContextPanel>
      <CoupleNotesBoard kind="vault" initialNotes={notes} persist={persist} />
    </>
  );
}

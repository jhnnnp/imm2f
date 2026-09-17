import { CoupleNotesBoard } from "@/features/lists/components/CoupleNotesBoard";
import { NotesContextPanel } from "@/features/lists/components/NotesContextPanel";
import { ContextPanel } from "@/components/layout/ContextPanel";
import { listNotes } from "@/features/lists/actions";

export default async function VaultPage() {
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

import { AppShell } from "@/components/layout/AppShell";
import { CoupleNotesBoard } from "@/features/lists/components/CoupleNotesBoard";
import { NotesContextPanel } from "@/features/lists/components/NotesContextPanel";
import { listNotes } from "@/features/lists/actions";

export default async function VaultPage() {
  const { notes, persist } = await listNotes("vault");
  return (
    <AppShell context={<NotesContextPanel kind="vault" notes={notes} />}>
      <CoupleNotesBoard kind="vault" initialNotes={notes} persist={persist} />
    </AppShell>
  );
}

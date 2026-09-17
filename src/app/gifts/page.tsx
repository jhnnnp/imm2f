import { AppShell } from "@/components/layout/AppShell";
import { CoupleNotesBoard } from "@/features/lists/components/CoupleNotesBoard";
import { NotesContextPanel } from "@/features/lists/components/NotesContextPanel";
import { listNotes } from "@/features/lists/actions";

export default async function GiftsPage() {
  const { notes, persist } = await listNotes("gift");
  return (
    <AppShell context={<NotesContextPanel kind="gift" notes={notes} />}>
      <CoupleNotesBoard kind="gift" initialNotes={notes} persist={persist} />
    </AppShell>
  );
}

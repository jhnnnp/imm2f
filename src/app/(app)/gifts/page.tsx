import { CoupleNotesBoard } from "@/features/lists/components/CoupleNotesBoard";
import { NotesContextPanel } from "@/features/lists/components/NotesContextPanel";
import { ContextPanel } from "@/components/layout/ContextPanel";
import { listNotes } from "@/features/lists/actions";

export default async function GiftsPage() {
  const { notes, persist } = await listNotes("gift");
  return (
    <>
      <ContextPanel>
        <NotesContextPanel kind="gift" notes={notes} />
      </ContextPanel>
      <CoupleNotesBoard kind="gift" initialNotes={notes} persist={persist} />
    </>
  );
}

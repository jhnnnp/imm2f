import { RouteSuspense } from "@/components/layout/RouteSuspense";
import { CoupleNotesBoard } from "@/features/lists/components/CoupleNotesBoard";
import { NotesContextPanel } from "@/features/lists/components/NotesContextPanel";
import { ContextPanel } from "@/components/layout/ContextPanel";
import { listNotes } from "@/features/lists/actions";

export default function GiftsPage() {
  return (
    <RouteSuspense>
      <GiftsPageContent />
    </RouteSuspense>
  );
}

async function GiftsPageContent() {
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

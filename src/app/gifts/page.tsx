import { AppShell } from "@/components/layout/AppShell";
import { CoupleNotesBoard } from "@/features/lists/components/CoupleNotesBoard";
import { listNotes } from "@/features/lists/actions";

export default async function GiftsPage() {
  const { notes, persist } = await listNotes("gift");
  return (
    <AppShell>
      <CoupleNotesBoard kind="gift" initialNotes={notes} persist={persist} />
    </AppShell>
  );
}

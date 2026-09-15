import { AppShell } from "@/components/layout/AppShell";
import { CoupleNotesBoard } from "@/features/lists/components/CoupleNotesBoard";
import { listNotes } from "@/features/lists/actions";

export default async function BucketPage() {
  const { notes, persist } = await listNotes("bucket");
  return (
    <AppShell>
      <CoupleNotesBoard kind="bucket" initialNotes={notes} persist={persist} />
    </AppShell>
  );
}

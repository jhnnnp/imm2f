import { AppShell } from "@/components/layout/AppShell";
import { CoupleNotesBoard } from "@/features/lists/components/CoupleNotesBoard";
import { listNotes } from "@/features/lists/actions";

export default async function VaultPage() {
  const { notes, persist } = await listNotes("vault");
  return (
    <AppShell>
      <CoupleNotesBoard kind="vault" initialNotes={notes} persist={persist} />
    </AppShell>
  );
}

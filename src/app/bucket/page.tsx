import { AppShell } from "@/components/layout/AppShell";
import { CoupleNotesBoard } from "@/features/lists/components/CoupleNotesBoard";
import { NotesContextPanel } from "@/features/lists/components/NotesContextPanel";
import { listNotes } from "@/features/lists/actions";
import { getAppSession } from "@/features/auth/session";

export default async function BucketPage() {
  const { notes, persist } = await listNotes("bucket");
  const session = await getAppSession();
  const collaborators = session.mode === "authenticated" ? {
    viewerId: session.userId,
    viewerName: session.displayName,
    partnerName: session.partner?.displayName ?? "파트너",
  } : undefined;
  return (
    <AppShell context={<NotesContextPanel kind="bucket" notes={notes} />}>
      <CoupleNotesBoard kind="bucket" initialNotes={notes} persist={persist} collaborators={collaborators} />
    </AppShell>
  );
}

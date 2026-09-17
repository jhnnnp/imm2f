import { CoupleNotesBoard } from "@/features/lists/components/CoupleNotesBoard";
import { NotesContextPanel } from "@/features/lists/components/NotesContextPanel";
import { ContextPanel } from "@/components/layout/ContextPanel";
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
    <>
      <ContextPanel>
        <NotesContextPanel kind="bucket" notes={notes} />
      </ContextPanel>
      <CoupleNotesBoard kind="bucket" initialNotes={notes} persist={persist} collaborators={collaborators} />
    </>
  );
}

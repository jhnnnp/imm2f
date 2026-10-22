import { readCoupleKeyDates } from "@/features/couple/keyDateActions";
import { listNotes } from "@/features/lists/actions";
import { seoulTodayIso } from "@/lib/dates";
import { chooseBucketWish, upcomingKeyDates } from "../homeMoments";
import { BucketWishCard, MomentUnavailable, UpcomingDaysCard } from "./HomeMoments";

export async function HomeUpcomingDays() {
  const snapshot = await readCoupleKeyDates().catch(() => null);
  if (!snapshot) return <MomentUnavailable kind="dates" />;
  if (!snapshot.persist) return null;
  return <UpcomingDaysCard events={upcomingKeyDates(snapshot.dates, seoulTodayIso())} />;
}

export async function HomeBucketWish() {
  const result = await listNotes("bucket").catch(() => null);
  if (!result) return <MomentUnavailable kind="wish" />;
  if (!result.persist) return null;
  return <BucketWishCard wish={chooseBucketWish(result.notes)} completed={result.notes.filter(note => note.status === "done").length} />;
}

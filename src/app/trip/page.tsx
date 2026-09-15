import type { Metadata } from "next";
import { TripPlanner } from "@/features/trip/components/TripPlanner";
export const metadata: Metadata = { title: "Trip" };
export default function TripPage() { return <TripPlanner />; }

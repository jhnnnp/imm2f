import type { Metadata } from "next";
import { DatePlanner } from "@/features/date/components/DatePlanner";
export const metadata: Metadata = { title: "Date" };
export default function DatePage() { return <DatePlanner />; }

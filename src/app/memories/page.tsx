import type { Metadata } from "next";
import { AppShell } from "@/components/layout/AppShell";
import { MemoryTimeline } from "@/features/memories/components/MemoryTimeline";
export const metadata: Metadata = { title: "Memories" };
export default function MemoriesPage() { return <AppShell><MemoryTimeline /></AppShell>; }

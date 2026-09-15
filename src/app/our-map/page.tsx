import type { Metadata } from "next";
import { AppShell } from "@/components/layout/AppShell";
import { CoupleMap } from "@/features/map/components/CoupleMap";
export const metadata: Metadata = { title: "Our Map" };
export default function OurMapPage() { return <AppShell><CoupleMap /></AppShell>; }

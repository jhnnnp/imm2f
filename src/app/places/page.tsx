import type { Metadata } from "next";
import { PlacesExperience } from "@/features/places/components/PlacesExperience";

export const metadata: Metadata = { title: "Places" };
export default function PlacesPage() { return <PlacesExperience />; }

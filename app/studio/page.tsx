import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { MissionStudio } from "../components/MissionStudio";
import { CapabilitySlice } from "../components/CapabilitySlice";
import { SiteFooter, SiteHeader } from "../components/SiteChrome";

export const metadata: Metadata = {
  title: "Earth Mission Studio | RTS AI",
  description: "Pin a real place on Earth, build a battlefield from it in your browser, and play it in RTS AI alone or with friends.",
  alternates: { canonical: "/studio" },
  robots: { index: false, follow: true },
};

export default function StudioPage() {
  return (
    <>
      <SiteHeader />
      <main id="main-content" className="route-main-light">
        <header className="route-hero route-hero-light">
          <span className="eyebrow">EARTH TO BATTLEFIELD</span>
          <h1>Choose a place.<br /><em>Shape a playable mission.</em></h1>
          <p>Search the real world, choose the size and the number of players, and build a battlefield you can play in your browser, alone or with friends.</p>
          <Link className="text-action" href="/platform">How Earth becomes playable <ArrowRight size={16} /></Link>
        </header>
        <MissionStudio />
        <CapabilitySlice
          light
          eyebrow="EARTH → OPENRA"
          title="A visible translation, not a magic button."
          intro="The studio keeps the source, transformation, validation, and editable output legible at every stage."
          ids={["earth-recon", "terrain-understanding", "map-validation", "editor-handoff"]}
        />
      </main>
      <SiteFooter />
    </>
  );
}

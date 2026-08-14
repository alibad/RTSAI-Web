import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { MissionStudio } from "../components/MissionStudio";
import { CapabilitySlice } from "../components/CapabilitySlice";
import { SiteFooter, SiteHeader } from "../components/SiteChrome";
import { getWindowsRelease } from "../../lib/release";

export const metadata: Metadata = {
  title: "Earth Mission Studio | RTS AI",
  description: "Pin a real place on Earth and generate a deterministic, validated, editable OpenRA battlefield in your browser.",
  alternates: { canonical: "/studio" },
};

export default async function StudioPage() {
  const windowsRelease = await getWindowsRelease();
  return (
    <>
      <SiteHeader />
      <main id="main-content" className="route-main-light">
        <header className="route-hero route-hero-light">
          <span className="eyebrow">EARTH TO BATTLEFIELD</span>
          <h1>Choose a place.<br /><em>Shape a playable mission.</em></h1>
          <p>Search the real world, inspect the source terrain, choose the gameplay footprint, and compile a validated OpenRA map without leaving the browser.</p>
          <Link className="text-action" href="/platform">How Earth becomes playable <ArrowRight size={16} /></Link>
        </header>
        <MissionStudio windowsRelease={windowsRelease} />
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

import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader, SiteFooter } from "../components/SiteChrome";

export const metadata: Metadata = {
  title: "Privacy — RTS AI",
  description: "How RTS AI handles website accounts, bounded analytics, feedback and optional local companion requests.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <><SiteHeader /><main id="main-content" className="privacy-page">
      <Link className="privacy-back" href="/">← Back to RTS AI</Link>
      <span className="eyebrow">Privacy / plain language</span>
      <h1>Your account helps you use the website.</h1>
      <p className="privacy-lede">The website uses Firebase Authentication for accounts and Google Analytics for bounded product events. Published game builds and locally tested companion features have different capabilities; a local check does not establish a hosted service.</p>
      <section id="ai-co-commander">
        <h2>Optional AI co-commander</h2>
        <div className="privacy-detail">
          <p>The published browser build runs without the local companion. The Windows release page lists the AI options offered by that installer. The newer browser integration and Mac candidate are locally tested and await publication.</p>
          <h3>Local and external requests</h3>
          <p>AI Off keeps manual gameplay available. A local companion can use deterministic alerts and grounded advice without a model. If you deliberately configure an external model endpoint, question text and a compact, fog-respecting match observation can be sent to that endpoint under its own terms. Optional visual or audio processing depends on the runtime you install and configure; do not assume it is present in a game download.</p>
          <p>The locally tested Mac candidate includes no model, microphone transcription or speech runtime. It starts with hosted access and automatic model installation disabled. Its reviewed native order controls do not establish neural inference or voice-conversation availability.</p>
          <h3>Hosted service status</h3>
          <p>A hosted co-commander is not advertised as available. The accepted companion contract requires verified server authentication, explicit provider approval and durable per-user and global budget enforcement before activation. The locally tested policy is a reference seam, not deployed cost enforcement. We do not promise anonymous access, an allowance, retention periods or a particular provider for an unverified service.</p>
          <h3>Your control over orders</h3>
          <p>Advice is read-only. In the accepted local integration, an order must be proposed, shown for review and explicitly applied by its displayed proposal ID. A lost confirmation reply leaves the outcome unknown until checked; it is not evidence that no order was sent. You can turn the companion off and continue manual play.</p>
        </div>
      </section>
      <section>
        <h2>Account data</h2>
        <p>Firebase Authentication stores account identity and sign-in information, including your name, email address, account identifier and account timestamps. We use it to sign you in, secure website features and support your account. Vercel hosts the website and handles network requests.</p>
        <p>The parked Earth map can request map tiles from OpenStreetMap. That tile request exposes your network address and the requested map area to the tile service.</p>
      </section>
      <section>
        <h2>Usage analytics</h2>
        <p>Website and game events can be associated with your pseudonymous Firebase user ID in Google Analytics: sign-ups and sign-ins, play and download clicks, the game loading, matches starting and ending (mode, map, faction, result), multiplayer matches (number of players and AI), applied AI co-commander suggestions, and game errors.</p>
        <p>We do not send your name, email, free-text mission prompt, search query, exact latitude and longitude, match codes or connection details to Google Analytics.</p>
        <p>Our Firebase database keeps a few counts for your account (matches, multiplayer matches, applied suggestions and errors) and overall totals.</p>
      </section>
      <section>
        <h2>Activity notices to the team</h2>
        <p>A sign-up, your first match, each multiplayer match start, game errors and product milestones send a private email to the RTS AI team. It includes your account name and email, an approximate location derived from your network address (country, region and city), your browser and operating system, and the page you came from. These notices are never sent to Google Analytics.</p>
      </section>
      <section>
        <h2>Multiplayer</h2>
        <p>To start a direct match, your browser briefly stores a connection description, including the network addresses it can be reached on, in our Firebase database. Only the match host can read it. It is deleted as soon as you are seated in the lobby or turned away, and the match itself is deleted when it starts or is closed. During a match, your browser connects directly to the host's, so players in the same match can see each other's network addresses.</p>
      </section>
      <section>
        <h2>Product feedback</h2>
        <p>Feedback you deliberately submit includes your Firebase account identity. It can be saved as a private GitHub issue, or accepted through a queued Firebase mail notification if issue creation fails. The receipt states whether an issue exists and whether a notification was queued; it does not confirm email delivery. If both paths fail, the form keeps your draft for retry.</p>
        <p>You can optionally include bounded browser, console and network diagnostics. Screenshots, page HTML, form values, request bodies, headers and URL queries are not captured. Written feedback and diagnostics are never sent to Google Analytics.</p>
      </section>
      <section>
        <h2>Your controls</h2>
        <p>You can sign out from the account menu. Account deletion and data-export controls remain planned before the website leaves alpha.</p>
      </section>
      <section>
        <h2>Public downloads</h2>
        <p>Browsing the site and downloading public game builds do not require an RTS AI account. Playing in the browser, the Map Workshop, the Faction Studio, the Faction viewer and the Earth Mission Studio require a free account, as do interactive website AI features. That website account does not enable a hosted in-game model service.</p>
      </section>
    </main><SiteFooter /></>
  );
}

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
        <p>Website events such as play-link and download-link clicks can be associated with your pseudonymous Firebase user ID. A click does not establish a completed download, successful game start or connected peer. A bounded game-start adapter is prepared for a future integrated browser build; current website listeners do not measure the separate play document.</p>
        <p>We do not send your name, email, free-text mission prompt, search query, exact latitude and longitude, lobby IDs or peer IDs to Google Analytics. The prepared game event carries only its version, mode and transport.</p>
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
        <p>Browsing the site and downloading public game builds do not require an RTS AI account. Interactive website AI features require sign-in. That website account does not enable a hosted in-game model service.</p>
      </section>
    </main><SiteFooter /></>
  );
}

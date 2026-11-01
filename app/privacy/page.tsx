import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader, SiteFooter } from "../components/SiteChrome";
import { LegalDraftNote } from "../components/LegalDraftNote";
import { LEGAL } from "../../lib/legal";

export const metadata: Metadata = {
  title: "Privacy — RTS AI",
  description: "How RTS AI handles website accounts, bounded analytics, feedback and optional local companion requests.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  const mail = `mailto:${LEGAL.contactEmail}`;
  return (
    <><SiteHeader /><main id="main-content" className="privacy-page">
      <Link className="privacy-back" href="/">← Back to RTS AI</Link>
      <span className="eyebrow">Privacy / plain language</span>
      <h1>Your account helps you use the website.</h1>
      <LegalDraftNote />
      <p className="privacy-lede">The website uses Firebase Authentication for accounts and Google Analytics for bounded product events. Published game builds and locally tested companion features have different capabilities; a local check does not establish a hosted service.</p>
      <section id="controller">
        <h2>Who is responsible</h2>
        <div className="privacy-detail">
          <p className="privacy-contact"><strong>{LEGAL.operator}</strong><span>{LEGAL.basedIn}</span><span><a href={mail}>{LEGAL.contactEmail}</a></span></p>
          <p>{LEGAL.operator} runs RTS AI and decides what happens to the data on this page (the &ldquo;data controller&rdquo;). Write to us to see, correct, export or delete your data, to object to how we use it, or with any question. You can also complain to the data protection authority where you live. Last updated {LEGAL.updated}.</p>
        </div>
      </section>
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
      <section id="analytics">
        <h2>Usage analytics</h2>
        <div className="privacy-detail">
        <p>We use Google Analytics to count visits and matches so we can improve RTS AI. You can turn it off on this device on your <Link href="/account">account page</Link>; it then stops on the website and in the game, and its cookies are removed. Advertising storage and ad signals are always off.</p>
        <p>While it is on, website and game events can be associated with your pseudonymous Firebase user ID in Google Analytics: sign-ups and sign-ins, play and download clicks, the game loading, matches starting and ending (mode, map, faction, result), multiplayer matches (number of players and AI), applied AI co-commander suggestions, and game errors. A click does not establish a completed download or a game start: the game reports those itself when it loads and when a match begins.</p>
        <p>We do not send your name, email, free-text mission prompt, search query, exact latitude and longitude, match codes or connection details to Google Analytics.</p>
        <p>Separately from Google Analytics, when you are signed in our own Firebase database keeps a few counts for your account (matches, multiplayer matches, applied suggestions and errors), a short daily record of when you played and with which faction and map, and overall totals. These counts work the same whatever you choose for analytics.</p>
        </div>
      </section>
      <section>
        <h2>Activity notices to the team</h2>
        <p>A sign-up, your first match, each multiplayer match start, game errors and product milestones send a private email to the RTS AI team. It includes your display name and account ID, an approximate location derived from your network address (region and country), your browser and operating system, and the page you came from. It does not include your email address or your city. These notices are never sent to Google Analytics; copies are kept in our database and in the team&apos;s private email archive (a Google Group).</p>
      </section>
      <section>
        <h2>Multiplayer</h2>
        <p>To start a direct match, your browser briefly stores a connection description, including the network addresses it can be reached on, in our Firebase database. Only the match host can read it. It is deleted as soon as you are seated in the lobby or turned away, and the match itself is deleted when it starts or is closed. During a match, your browser connects directly to the host’s, so players in the same match can see each other’s network addresses.</p>
      </section>
      <section>
        <h2>Saved maps</h2>
        <p>When you save a battlefield from the Earth studio, our Firebase database keeps it with your user ID: its name, the place and coordinates you picked, its settings, a preview picture and the map itself. Only you see your list of saved maps, but any signed-in player who has a map’s link or joins your match can load it, so the people you play with get your map. You can delete a saved map from the studio at any time.</p>
      </section>
      <section>
        <h2>Product feedback</h2>
        <p>Feedback you deliberately submit includes your Firebase account identity. It can be saved as a private GitHub issue, or accepted through a queued Firebase mail notification if issue creation fails. The receipt states whether an issue exists and whether a notification was queued; it does not confirm email delivery. If both paths fail, the form keeps your draft for retry.</p>
        <p>You can add screenshots (and mark them up first), one voice note and files: images, video, audio or text, up to 10 MB each. In the browser game, opening Feedback during a match attaches a picture of the battlefield, which you can remove before sending. Nothing is sent until you press send. The files are stored privately in our Firebase database with your account identifier, and only the RTS AI team can open them; the private issue and the team&apos;s alert name the files and link to that team-only page. Files stay until the team removes them or you delete your account.</p>
        <p>The microphone button in a text box uses your browser&apos;s speech recognition (in Chrome, Google&apos;s service) to type for you; it attaches no audio. A voice note is a recording you choose to attach.</p>
        <p>You can optionally include bounded browser, console and network diagnostics. Page HTML, form values, request bodies, headers and URL queries are not captured. Written feedback and diagnostics are never sent to Google Analytics.</p>
      </section>
      <section>
        <h2>Your controls</h2>
        <div className="privacy-detail">
          <p>On your <Link href="/account">account page</Link> you can:</p>
          <ul>
            <li><strong>Download your data:</strong> one file with your account details, counts, daily records, saved maps, the records of feedback files you sent, and the team emails about you.</li>
            <li><strong>Delete your account:</strong> removes your sign-in, counts, daily records, saved maps, feedback files and the team emails about you from our database straight away. The team is then asked to remove the remaining copies by hand: your feedback issues on GitHub, the email archive, and Google Analytics data for your account ID.</li>
            <li><strong>Turn analytics on or off</strong> on that device.</li>
          </ul>
          <p>Overall totals (such as the number of matches played) are not personal and stay. You can also sign out from the account menu, or write to <a href={mail}>{LEGAL.contactEmail}</a> and we&apos;ll do any of this for you.</p>
        </div>
      </section>
      <section id="where">
        <h2>Where your data is kept</h2>
        <div className="privacy-detail">
          <ul>
            <li><strong>Google Firebase:</strong> accounts (Authentication) and our database (Firestore, in Dammam, Saudi Arabia). Small Firebase functions in Belgium send the team&apos;s emails, record daily activity and run downloads and deletions.</li>
            <li><strong>Vercel</strong> hosts the website and <strong>Cloudflare</strong> delivers the game&apos;s files; both see your network address when you load a page.</li>
            <li><strong>Google Analytics</strong>, only if you allow it.</li>
            <li><strong>GitHub</strong> keeps feedback as private issues; a <strong>Google Group</strong> keeps the team&apos;s email archive, sent from our own mail server.</li>
          </ul>
          <p>Some of these companies store data outside your country. We keep your data while you have an account; deleting it starts the removal described above.</p>
        </div>
      </section>
      <section>
        <h2>Public downloads</h2>
        <p>Browsing the site and downloading public game builds do not require an RTS AI account. Playing in the browser, the Map Workshop, the Faction Studio, the Faction viewer and the Earth Mission Studio require a free account, as do interactive website AI features. That website account does not enable a hosted in-game model service.</p>
      </section>
    </main><SiteFooter /></>
  );
}

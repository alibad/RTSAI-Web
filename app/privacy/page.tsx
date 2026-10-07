import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader, SiteFooter } from "../components/SiteChrome";

export const metadata: Metadata = {
  title: "Privacy — RTS AI",
  description: "How RTS AI handles account identity, product analytics, feedback and the hosted AI co-commander.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <><SiteHeader /><main id="main-content" className="privacy-page">
      <Link className="privacy-back" href="/">← Back to RTS AI</Link>
      <span className="eyebrow">Privacy / plain language</span>
      <h1>Your identity is for your account—not ad targeting.</h1>
      <p className="privacy-lede">RTS AI uses Firebase Authentication to create your website account and Google Analytics to understand whether the product is useful. In the game, the AI co-commander can think on rtsai.net with Claude, without an account; that is explained below.</p>

      <section id="ai-co-commander">
        <h2>AI co-commander in the game</h2>
        <div className="privacy-detail">
          <p>Hosted AI is planned for the first RTS AI release and still needs live service verification. The previous Classic alpha uses its own local AI pack or an external provider you choose.</p>
          <p>You choose how the co-commander thinks, and can change it at any time in the game&apos;s AI settings. <b>Hosted</b> is the default for new installs. <b>Local</b> runs everything on your PC. <b>External</b> sends requests to an AI service you choose, under that service&apos;s own terms. <b>AI Off</b> turns the co-commander off. Only Hosted involves rtsai.net.</p>
          <h3>What hosted mode sends</h3>
          <p>When the co-commander needs to think, the game sends rtsai.net a compact snapshot of the match state, up to two downscaled screenshots of your game view, and the text of the question you spoke or typed. rtsai.net checks your allowance and forwards these to Anthropic, whose Claude model writes the answer. They are used to answer that request; rtsai.net does not store them and does not write them to its logs.</p>
          <h3>What stays on your PC</h3>
          <p>Your voice audio is transcribed on your own PC, and spoken replies are generated there too. Audio is never uploaded; only the transcribed text of a question is sent, as above.</p>
          <h3>What rtsai.net keeps</h3>
          <ul>
            <li><b>An anonymous install token.</b> On first launch the game receives a token tied to a random install ID, not to your name, email or a website account. No account is required. We keep the install record (its creation time and whether it is active) so the token keeps working; if you ever link the install to an rtsai.net account to raise your allowance, the record also holds that account&apos;s ID.</li>
            <li><b>IP addresses for rate limiting only.</b> When an install registers, your IP address is converted into a keyed hash and used to limit how many new installs one network can register per day. The raw address is not stored by RTS AI, and the hashed counter is set to expire within two days.</li>
            <li><b>Daily usage counters that expire.</b> For each install we count requests, tokens and cost per day so the free allowance and abuse limits work. These counters are set to expire within three days (per-minute counters after one day) and are then deleted automatically. Service-wide daily totals, which are not linked to any install, are kept for 60 days for cost control.</li>
            <li><b>Operational logs.</b> Each hosted request writes one log line with a shortened install ID, token counts, the number and size of images, cost and response time. It never includes your questions, the snapshot, screenshots or the answer.</li>
          </ul>
          <h3>Who processes what</h3>
          <ul>
            <li><b>RTS AI (rtsai.net)</b> checks your token and allowance and forwards hosted requests.</li>
            <li><b>Anthropic</b> receives the snapshot, screenshots and question text of hosted requests to generate answers, under its commercial terms.</li>
            <li><b>Vercel</b> hosts rtsai.net and handles the network requests, including your IP address.</li>
            <li><b>Google Firebase (Cloud Firestore)</b> stores the install records and usage counters described above.</li>
          </ul>
          <h3>How to opt out</h3>
          <p>Choose AI Off, Local, or External in the game&apos;s AI settings. With AI Off or Local, nothing from your match is sent to rtsai.net or Anthropic.</p>
        </div>
      </section>
      <section>
        <h2>Account data</h2>
        <p>When you sign up, Firebase Authentication stores your name, email address, encrypted credential information, account identifier, and basic account timestamps. We use that information to sign you in, address you in the interface, secure AI features, and support your account.</p>
      </section>
      <section>
        <h2>Usage analytics</h2>
        <p>Feature events can be associated with your pseudonymous Firebase user ID. We do not send your name, email, free-text mission prompt, search query, or exact latitude and longitude to Google Analytics.</p>
      </section>
      <section>
        <h2>Product feedback</h2>
        <p>Feedback you deliberately submit becomes a private GitHub issue with your Firebase account identity so we can investigate and reply. An admin alert is queued through our existing Firebase mail system. You can optionally include bounded browser, console, and network diagnostics; screenshots, page HTML, form values, request bodies, headers, and URL queries are not captured. Written feedback and diagnostics are never sent to Google Analytics.</p>
      </section>
      <section>
        <h2>Your controls</h2>
        <p>You can sign out at any time from the account menu. Account deletion and data-export controls will be added before the service leaves alpha.</p>
      </section>
      <section>
        <h2>Public downloads</h2>
        <p>Browsing the marketing site, downloading public game builds and using the in-game co-commander do not require an RTS AI account. Generating a mission or using interactive AI surfaces on this website does.</p>
      </section>
    </main><SiteFooter /></>
  );
}

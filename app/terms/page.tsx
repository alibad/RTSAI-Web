import type { Metadata } from "next";
import Link from "next/link";
import { modSource } from "../components/SiteChrome";
import { LegalDraftNote } from "../components/LegalDraftNote";
import { LEGAL } from "../../lib/legal";
import { PathPage } from "../components/PathChrome";

export const metadata: Metadata = {
  title: "Terms — RTS AI",
  description: "The rules for using rtsai.net and playing RTS AI, in plain words.",
  alternates: { canonical: "/terms" },
};

// Plain-words terms for the owner's review (lib/legal.ts holds who runs RTS AI and the draft switch).
export default function TermsPage() {
  const mail = `mailto:${LEGAL.contactEmail}`;
  return (
    <PathPage><main id="main-content" className="privacy-page legal-page">
      <Link className="privacy-back" href="/">← Back to RTS AI</Link>
      <span className="eyebrow">Terms / plain language</span>
      <h1>The rules for playing RTS AI.</h1>
      <LegalDraftNote />
      <p className="privacy-lede">These terms are the agreement between you and {LEGAL.operator} when you use rtsai.net, play in your browser or download the game. Last updated {LEGAL.updated}.</p>
      <section id="who">
        <h2>Who we are</h2>
        <div className="privacy-detail">
          <p>RTS AI is made by {LEGAL.operator}, based in {LEGAL.basedIn}. Questions about these terms go to <a href={mail}>{LEGAL.contactEmail}</a>.</p>
        </div>
      </section>
      <section id="account">
        <h2>Your account</h2>
        <div className="privacy-detail">
          <p>The account is free. You need one to play in the browser and to use the Workshop and the studios; browsing and downloads don&apos;t need one.</p>
          <ul>
            <li>You must be at least {LEGAL.minimumAge}, or older if the law where you live says so. Under 18? Ask a parent or guardian first.</li>
            <li>Use your own email and keep your password to yourself. One account per person.</li>
            <li>You are responsible for what happens on your account. Tell us if you think someone else is using it.</li>
            <li>You can download your data or delete your account at any time on your <Link href="/account">account page</Link>.</li>
          </ul>
        </div>
      </section>
      <section id="fair-play">
        <h2>Play fair</h2>
        <div className="privacy-detail">
          <ul>
            <li>Don&apos;t cheat, exploit bugs to win multiplayer matches, or spoil the game for other players.</li>
            <li>Don&apos;t attack or overload our services, try to get into other players&apos; accounts, or use bots to create accounts or send feedback.</li>
            <li>Be decent to other players and to the team: no harassment, hate, threats or illegal content.</li>
          </ul>
        </div>
      </section>
      <section id="fiction">
        <h2>A fictional war</h2>
        <div className="privacy-detail">
          <p>The factions are inspired by real countries and groups, but the war, the story and the missions are fiction. They don&apos;t describe real events or the views of anyone involved in making the game.</p>
        </div>
      </section>
      <section id="your-content">
        <h2>What you make</h2>
        <div className="privacy-detail">
          <p>Maps you save and feedback you send stay yours. You let us store them, show a saved map to the players you share it with or play it with, and use your feedback to improve RTS AI, without paying you for it. Only upload what you have the right to share.</p>
        </div>
      </section>
      <section id="alpha">
        <h2>Early days</h2>
        <div className="privacy-detail">
          <p>RTS AI is in alpha. Features change, things break, and the browser game, multiplayer or the AI co-commander can be unavailable at times. We may have to reset or remove data such as saved maps or stats; when we can, we&apos;ll tell you first.</p>
          <p>The AI co-commander gives game advice and can be wrong. You decide which of its orders to apply.</p>
        </div>
      </section>
      <section id="open-source">
        <h2>Open source</h2>
        <div className="privacy-detail">
          <p>The game runs on the open-source OpenRA engine, and its code is published under its own open-source licences (see the <a href={modSource}>game source</a>). Nothing here limits the rights those licences give you. The RTS AI name, logo and website design are not part of those licences.</p>
        </div>
      </section>
      <section id="ending">
        <h2>Stopping</h2>
        <div className="privacy-detail">
          <p>You can stop playing and delete your account whenever you like. We may suspend or close an account that breaks these terms, or close RTS AI altogether; when we can, we&apos;ll tell you why and give you time to download your data.</p>
        </div>
      </section>
      <section id="liability">
        <h2>No promises we can&apos;t keep</h2>
        <div className="privacy-detail">
          <p>RTS AI is free and offered as it is. As far as the law allows, we are not responsible for lost progress, lost data or other indirect losses from using it. Nothing in these terms takes away rights you have by law where you live.</p>
          <p>The laws of {LEGAL.governingLaw} apply to these terms, without removing the protection your own country&apos;s law gives you.</p>
        </div>
      </section>
      <section id="changes">
        <h2>Changes</h2>
        <div className="privacy-detail">
          <p>If we change these terms in a way that matters, we&apos;ll update the date above and tell signed-in players on the site before the change applies. If you keep playing after that, the new terms apply.</p>
        </div>
      </section>
      <section id="contact">
        <h2>Questions</h2>
        <div className="privacy-detail">
          <p>Write to <a href={mail}>{LEGAL.contactEmail}</a>. How we handle your data is on the <Link href="/privacy">privacy page</Link>.</p>
        </div>
      </section>
    </main></PathPage>
  );
}

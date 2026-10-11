import type { Metadata } from "next";
import { Apple, BrainCircuit, CalendarDays, Cpu, Download, ExternalLink, FileArchive, Globe, HardDrive, MemoryStick, Mic, MonitorDown, PackageCheck, PowerOff, ShieldAlert, ShieldCheck, Wifi } from "lucide-react";
import Link from "next/link";
import { SiteFooter, SiteHeader } from "../components/SiteChrome";
import { getGameRelease } from "../../lib/release";
import { getModRelease, isPublished, macInstaller, windowsInstaller, type ModReleaseAsset } from "../../lib/mod-release";
import { getMacAlphaRelease } from "../../lib/mac-release";
import { availability, CLASSIC_ADDON_NOTE, factionById, modeLabel, resolveMode, rosterFactionById } from "../../lib/game-content";
import "./download.css";
import { FrontLine } from "../components/FrontLine";

const releaseAtBuild = getModRelease();
const macAlphaRelease = getMacAlphaRelease();
const releasedVersion = isPublished(releaseAtBuild) ? releaseAtBuild.version : null;
const releasedPlatforms = macInstaller(releaseAtBuild) ? "Windows and macOS" : "Windows";

export const metadata: Metadata = releasedVersion
  ? {
    title: macAlphaRelease ? "Download RTS AI | Windows, Mac alpha, or play in your browser" : `Download RTS AI ${releasedVersion} | ${releasedPlatforms}, or play in your browser`,
    description: macAlphaRelease ? `Download Windows ${releasedVersion} or the separate macOS 15+ alpha, or play both standalone modes free in your browser at rtsai.net/play. No owned Red Alert installation is required.` : `RTS AI is a modern real-time strategy game with seven real-world factions. Download the ${releasedVersion} alpha for ${releasedPlatforms}, or play free in your browser at rtsai.net/play. Nothing else to install.`,
    alternates: { canonical: "/download" },
  }
  : {
    title: "Play RTS AI | In your browser now, Windows coming soon",
    description: "RTS AI is a modern real-time strategy game with seven real-world factions and an AI co-commander. Play free in your browser now at rtsai.net/play; the Windows download is coming soon. Nothing else to install.",
    alternates: { canonical: "/download" },
  };

function formatBytes(bytes: number | null) {
  if (!bytes) return null;
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value: string | null) {
  if (!value) return "Verified release";
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}

const kindLabels: Record<ModReleaseAsset["kind"], string> = { installer: "Installer", portable: "Portable ZIP", "ai-pack": "AI pack", other: "File" };
const platformLabels: Record<ModReleaseAsset["platform"], string> = { "windows-x64": "Windows x64", "windows-x86": "Windows x86", macos: "macOS", linux: "Linux", any: "All platforms" };

const aiChoices = [
  {
    id: "local",
    icon: Cpu,
    title: "Full local AI",
    badge: "~1.8 GB",
    size: "Qwen3-VL, Whisper and Kokoro",
    description: "The co-commander runs entirely on your PC: thinking, map vision, speech recognition and voice. Nothing is sent to rtsai.net or Anthropic.",
    note: "Best with 16 GB of memory; answer speed depends on your CPU.",
  },
  {
    id: "none",
    icon: PowerOff,
    title: "No AI",
    badge: "Default",
    size: "No model download",
    description: "Play without the co-commander. Nothing is downloaded for AI and nothing is sent to rtsai.net.",
    note: "You can turn the co-commander on later in the game's settings.",
  },
] as const;

const requirements = [
  { icon: MonitorDown, label: "System", value: "Windows 10 or 11, 64-bit" },
  { icon: PackageCheck, label: "Game", value: "Nothing else: RTS AI brings its own art, sound and maps" },
  { icon: Cpu, label: "Processor", value: "4-core x64 CPU with AVX2 for local voice and local AI" },
  { icon: MemoryStick, label: "Memory", value: "8 GB; 16 GB recommended for Full local AI" },
  { icon: HardDrive, label: "Storage", value: "About 5 GB free (6 GB with Full local AI)" },
  { icon: Wifi, label: "Internet", value: "Needed for the installer and optional models; local skirmishes and local AI run offline" },
  { icon: Mic, label: "Microphone", value: "Optional, for push-to-talk questions" },
] as const;

/** The same targets without the co-commander's needs, for a release that ships without it. */
const requirementsWithoutAI = [
  { icon: MonitorDown, label: "System", value: "Windows 10 or 11, 64-bit" },
  { icon: PackageCheck, label: "Game", value: "Nothing else: RTS AI brings its own art, sound and maps" },
  { icon: Cpu, label: "Processor", value: "64-bit x64 processor" },
  { icon: MemoryStick, label: "Memory", value: "8 GB" },
  { icon: HardDrive, label: "Storage", value: "About 1 GB free" },
  { icon: Wifi, label: "Internet", value: "Only for the download; skirmishes play offline" },
] as const;

export default async function DownloadPage({ searchParams }: { searchParams: Promise<{ faction?: string | string[]; mode?: string | string[] }> }) {
  const selection = await searchParams;
  const mode = resolveMode(selection.mode, "ra2");
  const dossier = typeof selection.faction === "string" ? factionById(selection.faction) : undefined;
  const faction = dossier ?? (typeof selection.faction === "string" ? rosterFactionById(selection.faction, mode) : undefined);
  const selectionStatus = dossier ? availability(dossier, mode) : faction ? "Development · release unconfirmed" : undefined;
  const mod = getModRelease();
  const published = isPublished(mod) ? mod : null;
  const installer = windowsInstaller(mod);
  const mac = published ? macInstaller(mod) : null;
  // A published release only describes the co-commander modes its installer really offers.
  const noCoCommander = Boolean(published && published.aiModes.length === 0);
  const offeredChoices = published ? aiChoices.filter((choice) => choice.id === "none" || published.aiModes.some((mode) => mode === choice.id)) : aiChoices;
  const shownRequirements = noCoCommander ? requirementsWithoutAI : requirements;

  const gameRelease = await getGameRelease();
  const windowsRelease = gameRelease.windows;
  const classicWindowsUrl = windowsRelease.installerUrl ?? windowsRelease.url;
  const classicWindowsSize = formatBytes(windowsRelease.installerSizeBytes ?? windowsRelease.sizeBytes);
  const classicAiPackSize = formatBytes(windowsRelease.aiPackSizeBytes);
  const appleSiliconRelease = gameRelease.macos?.assets.find((asset) => asset.architecture === "arm64");
  const intelMacRelease = gameRelease.macos?.assets.find((asset) => asset.architecture === "x64");

  const selectionHeading = !faction
    ? null
    : selectionStatus === "In public Windows release"
      ? mode === "ra2" ? `${faction.name} is in RTS AI ${published?.version}` : `${faction.name} is in the earlier Classic prototype`
      : selectionStatus === "Not in this mode"
        ? `${faction.name} is not in ${modeLabel(mode)}`
        : mode === "ra2" ? "Not released yet" : "Not in the earlier Classic prototype";
  const selectionBody = !faction
    ? null
    : selectionStatus === "Not in this mode"
      ? "There is no implementation of this faction in this mode, and no download on this page adds one."
      : mode === "ra2"
        ? selectionStatus === "In public Windows release"
          ? "Download the Windows installer above."
          : published
            ? `RTS AI ${published.version} is out, but ${faction.name} has not been verified in it yet.`
            : "Play it in your browser now at rtsai.net/play. The Windows download is coming soon."
        : selectionStatus === "In public Windows release"
          ? `This historical Classic catalog does not certify the current standalone Classic release.`
          : "The standalone Classic build passed local checks, but this historical catalog does not certify its faction coverage or public availability.";

  return (
    <>
      <SiteHeader />
      <main id="main-content">
        <header className="route-hero download-route-hero play-hero">
          <span className="eyebrow">{mac ? "RTS AI / BROWSER, WINDOWS AND MACOS" : "RTS AI / BROWSER AND WINDOWS"}</span>
          <h1>Play RTS AI.<br /><em>{published ? "Out now." : "Now in your browser."}</em></h1>
          <p>Web RTS and Downloadable RTS share one standalone game. Nothing else to install: RTS AI brings its own art, sound and maps.</p>
          <p>The Windows alpha and separate Mac alpha are described by their release files below. Play both Classic/top-down and isometric modes in the browser. Both standalone modes require no owned Red Alert installation.</p>
          <div className={`play-options ${mac ? "has-three" : ""}`}>
            <article className="play-option">
              <Globe size={24} aria-hidden="true" />
              <div><span className="platform-kicker">rtsai.net/play</span><h2>Play in your browser</h2><p>No install. Open the page and command.</p></div>
              {/* /play is the browser game's own Vercel project behind a proxy, not a page of this app: a plain link. */}
              <a className="primary-action" href="/play/" data-analytics-event="play_browser"><Globe size={17} /> Play now</a>
            </article>
            <article className="play-option">
              <MonitorDown size={24} aria-hidden="true" />
              <div><span className="platform-kicker">Windows 10 / 11, 64-bit</span><h2>Download for Windows</h2><p>{noCoCommander ? "The standalone game, with built-in bots." : "Both game modes, campaigns and an optional local co-commander."}</p></div>
              {published && installer
                ? <a className="primary-action" href={installer.url} data-analytics-event="mod_download" data-platform="windows-x64-setup"><Download size={17} /> Download RTS AI {published.version}</a>
                : <span className="pending-download" aria-disabled="true">Coming soon</span>}
            </article>
            {published && mac && (
              <article className="play-option">
                <Apple size={24} aria-hidden="true" />
                <div><span className="platform-kicker">macOS, Apple silicon and Intel</span><h2>Download for Mac</h2><p>The same game as one universal app. Not notarized yet: approve it once in Privacy &amp; Security.</p></div>
                <a className="primary-action" href={mac.url} data-analytics-event="mod_download" data-platform="macos-dmg"><Download size={17} /> Download for Mac</a>
              </article>
            )}
          </div>
          {published && installer && (
            <div className="release-trust" aria-label="Release details">
              <span><CalendarDays size={15} /> Released {formatDate(published.publishedAt)}</span>
              <span>{published.signed ? <ShieldCheck size={15} /> : <ShieldAlert size={15} />} {published.signed ? "Authenticode signed" : "Unsigned alpha"}</span>
              <span><FileArchive size={15} /> {formatBytes(installer.sizeBytes)} installer, SHA-256 below</span>
              {mac && <span><Apple size={15} /> {formatBytes(mac.sizeBytes)} Mac disk image</span>}
              <a href={published.releaseUrl}><ExternalLink size={15} /> Release on GitHub</a>
            </div>
          )}
          <FrontLine />
        </header>

        {faction && (
          <aside className="release-selection" aria-label="Selected faction and release availability">
            <span className="section-number">{`${faction.name} / ${modeLabel(mode)}`}</span>
            <h2>{selectionHeading}</h2>
            <p>{selectionBody}</p>
            <Link href={`/factions/${faction.id}?mode=${mode}`}>Back to the faction guide →</Link>
          </aside>
        )}

        <details className="planned-setup" open={Boolean(published)}><summary>{published ? "Setup and system requirements" : "Planned Windows setup and system requirements"}</summary>
        <section className="download-section mod-setup" aria-labelledby="ai-choice-title">
          {noCoCommander && published ? (
          <div className="download-intro">
            <span className="section-number">01 / AI CO-COMMANDER</span>
            <h2 id="ai-choice-title">No co-commander in this download yet.</h2>
            <p>RTS AI {published.version} plays skirmishes against the built-in bots, and the installer asks no AI question. Local companion integration has separate acceptance evidence; that does not add it to this published installer.</p>
          </div>
          ) : (<>
          <div className="download-intro">
            <span className="section-number">01 / THE INSTALLER ASKS ONE QUESTION</span>
            <h2 id="ai-choice-title">How should your co-commander think?</h2>
            <p>{published ? "Pick one when you install." : "The local Windows build defaults to no model download; full local AI is optional."} You can switch later in the game&apos;s settings: AI Off, Local, or External (your own OpenAI-compatible endpoint). See <Link href="/privacy#ai-co-commander">AI privacy</Link>.</p>
          </div>
          <div className="ai-choices">
            {offeredChoices.map((choice) => (
              <article className={`ai-choice ${choice.id === "none" ? "is-default" : ""}`} key={choice.id}>
                <div className="platform-card-heading"><span className="platform-icon"><choice.icon size={22} /></span><div><span className="platform-kicker">{choice.size}</span><h3>{choice.title}</h3></div><span className={`release-status ${choice.id === "none" ? "is-ready" : ""}`}>{choice.badge}</span></div>
                <p>{choice.description}</p>
                <small>{choice.note}</small>
              </article>
            ))}
          </div>

          </>)}

          <div className="download-intro">
            <span className="section-number">02 / WINDOWS REQUIREMENTS</span>
            <h2>What your PC needs.</h2>
            <p>{noCoCommander ? "These are the targets for this alpha; a clean-machine hardware matrix is still being validated." : "These are the documented targets for the Windows download; a clean-machine hardware matrix is still being validated, so we do not promise AI response times."}</p>
          </div>
          <dl className="mod-requirements">
            {shownRequirements.map((item) => (
              <div key={item.label}><dt><item.icon size={15} aria-hidden="true" /> {item.label}</dt><dd>{item.value}</dd></div>
            ))}
          </dl>

          {published && !published.signed && (
            <div className="unsigned-note" role="note">
              <ShieldAlert size={18} aria-hidden="true" />
              <p><b>This alpha installer is not code-signed yet.</b> Windows SmartScreen may say &ldquo;Windows protected your PC&rdquo;. Before choosing More info, then Run anyway, check that the file&apos;s SHA-256 matches the one listed below: in PowerShell, run <code>Get-FileHash .\{installer?.name} -Algorithm SHA256</code>.</p>
            </div>
          )}
          {published && mac && (
            <div className="unsigned-note" role="note">
              <ShieldAlert size={18} aria-hidden="true" />
              <p><b>The Mac app is not notarized yet.</b> Check the SHA-256 first: in Terminal, run <code>shasum -a 256 {mac.name}</code>. Drag RTS AI to Applications and open it; when macOS says it cannot check the app, open System Settings, Privacy &amp; Security, and choose Open Anyway. On macOS 14 and earlier, right-click the app and choose Open.</p>
            </div>
          )}
        </section>
        </details>

        <section className={`download-section mod-downloads ${published ? "" : "is-unpublished"}`} id="mod-downloads" aria-labelledby="mod-downloads-title">
          <div className="download-intro">
            <span className="section-number">{published ? "DOWNLOADS" : "RTS AI"}</span>
            <h2 id="mod-downloads-title">{published ? `RTS AI ${published.version}` : "Release status"}</h2>
            <p>{published ? "Every file comes from the public GitHub release. Compare its SHA-256 before you run it." : "Explore the current factions while their art and gameplay are refined."}</p>
          </div>
          {published ? (
            <ul className="mod-asset-list" aria-label={`RTS AI ${published.version} files`}>
              {published.assets.map((asset) => (
                <li key={asset.name}>
                  <div><span className="platform-kicker">{kindLabels[asset.kind]} / {platformLabels[asset.platform]} / {formatBytes(asset.sizeBytes)}</span><b>{asset.name}</b><code aria-label={`SHA-256 of ${asset.name}`}>{asset.sha256}</code></div>
                  <a className={asset.kind === "installer" && asset.platform === "windows-x64" ? "primary-action" : "secondary-download"} href={asset.url} data-analytics-event="mod_download" data-platform={`${asset.platform}-${asset.kind}`}><Download size={15} /> Download</a>
                </li>
              ))}
            </ul>
          ) : (
            <div className="mod-pending">
              <span className="pending-download" aria-disabled="true">Windows download not yet published</span>
              <Link className="text-action" href="/factions">Meet the factions</Link>
            </div>
          )}
        </section>

        <section className="download-section" aria-labelledby="local-mac-title">
          <div className="download-intro">
            <span className="section-number">{macAlphaRelease ? "MAC ALPHA / SEPARATE PRERELEASE" : "LOCAL ACCEPTANCE / NOT PUBLISHED"}</span>
            <h2 id="local-mac-title">{macAlphaRelease ? "Standalone Mac alpha." : "Standalone Mac candidate."}</h2>
            <p>The macOS 15+ build passed local checks in both modes. It uses an ad-hoc signature and is not notarized. Game binaries are universal; the bundled companion supports Apple silicon only. Intel execution and another Mac remain pending. No model, microphone transcription or speech runtime is included. Grounded advice and individually reviewed native orders were checked locally; neural inference and voice conversations were not.</p>
            <p>Native and browser unit-voice settings support faction-language defaults and an English override. Fluent listening review remains pending.</p>
            {macAlphaRelease ? <>
              <a className="primary-action" href={macAlphaRelease.asset.url} data-analytics-event="mod_download" data-platform="macos-alpha-dmg"><Download size={17} /> Download Mac alpha</a>
              <p>{formatBytes(macAlphaRelease.asset.sizeBytes)} · Internal version {macAlphaRelease.internalVersion} · <a href={macAlphaRelease.releaseUrl}>Release notes and checksum</a></p>
              <p>SHA-256: <code>{macAlphaRelease.asset.sha256}</code></p>
              <p>Copy the app to Applications and attempt to open it. If macOS blocks it, use System Settings &gt; Privacy &amp; Security &gt; Open Anyway after checking the checksum.</p>
            </> : <p>This candidate is not a public download.</p>}
          </div>
        </section>
        <p className="classic-addon-note">{CLASSIC_ADDON_NOTE}</p>

        <details className="download-section classic-alpha" id="classic-alpha">
          <summary className="download-intro">
            <span className="section-number">{`EARLIER PROTOTYPE / ${windowsRelease.version}`}</span>
            <h2 id="classic-alpha-title">Earlier Classic prototype</h2>
            <p>OpenRA AI {windowsRelease.version} is the earlier public prototype, built on OpenRA&apos;s classic battlefield, with the co-commander and the Red Sea 2026 slice (Saudi Arabia and Yemen). It stays available as it is; it is not RTS AI.</p>
          </summary>
          <div className="platform-downloads" aria-label="Earlier Classic prototype downloads">
            <article className="platform-card is-pending">
              <div className="platform-card-heading"><span className="platform-icon"><MonitorDown size={23} /></span><div><span className="platform-kicker">Windows 10 / 11</span><h3>Classic prototype for Windows</h3></div><span className="release-status is-pending">{windowsRelease.authenticode === "verified" ? "Signed" : "Unsigned alpha"}</span></div>
              <p>{windowsRelease.authenticode === "verified" ? "An Authenticode-signed per-user setup." : "Checksum-verified but not Authenticode-signed, so SmartScreen may warn before launch."} Released {formatDate(windowsRelease.publishedAt)}.</p>
              <a className="secondary-download" href={classicWindowsUrl} data-analytics-event="game_download" data-platform="windows-x64-setup"><Download size={15} /> Classic prototype setup ({classicWindowsSize})</a>
              <div className="platform-meta">{windowsRelease.installerChecksumUrl && <a href={windowsRelease.installerChecksumUrl}>Setup checksum</a>}<a href={windowsRelease.url} data-analytics-event="game_download" data-platform="windows-x64-portable">Portable ZIP</a><a href={windowsRelease.checksumUrl}>ZIP checksum</a>{windowsRelease.aiPackUrl && <a href={windowsRelease.aiPackUrl} data-analytics-event="ai-pack-download" data-platform="windows-x64">Classic Local AI Pack ({classicAiPackSize})</a>}{windowsRelease.aiPackChecksumUrl && <a href={windowsRelease.aiPackChecksumUrl}>AI Pack checksum</a>}</div>
            </article>
            <article className="platform-card is-pending">
              <div className="platform-card-heading"><span className="platform-icon"><Apple size={23} /></span><div><span className="platform-kicker">Apple desktop</span><h3>Classic prototype for macOS</h3></div><span className="release-status is-pending">{gameRelease.macos ? "Notarized" : "Not available"}</span></div>
              {gameRelease.macos ? (
                <>
                  <p>{intelMacRelease ? "Signed and notarized disk images for Apple silicon and Intel." : "A signed and notarized disk image for Apple silicon."} Version {gameRelease.macos.version}.</p>
                  <div className="mac-download-actions">{appleSiliconRelease && <a className="secondary-download" href={appleSiliconRelease.url} data-analytics-event="game_download" data-platform="macos-arm64"><Download size={15} /> Apple silicon</a>}{intelMacRelease && <a className="secondary-download" href={intelMacRelease.url} data-analytics-event="game_download" data-platform="macos-x64">Intel Mac</a>}</div>
                  <div className="platform-meta">{appleSiliconRelease?.checksumUrl && <a href={appleSiliconRelease.checksumUrl}>Apple silicon checksum</a>}{intelMacRelease?.checksumUrl && <a href={intelMacRelease.checksumUrl}>Intel checksum</a>}</div>
                </>
              ) : (
                <><p>No signed macOS build of the Classic prototype is published.</p><span className="pending-download" aria-disabled="true">No placeholder download</span></>
              )}
            </article>
          </div>
          <div className="download-footnote"><BrainCircuit size={15} /><span>The earlier prototype keeps its own AI setup. The current Windows game above includes both mode choices and optional local AI.</span></div>
        </details>
      </main>
      <SiteFooter />
    </>
  );
}

import type { Metadata } from "next";
import { Apple, BrainCircuit, CalendarDays, Cloud, Cpu, Disc3, Download, ExternalLink, FileArchive, HardDrive, Hourglass, MemoryStick, Mic, MonitorDown, PowerOff, ShieldAlert, ShieldCheck, Wifi } from "lucide-react";
import Link from "next/link";
import { SiteFooter, SiteHeader } from "../components/SiteChrome";
import { getGameRelease } from "../../lib/release";
import { getModRelease, isPublished, RA2_REQUIREMENT, windowsInstaller, type ModReleaseAsset } from "../../lib/mod-release";
import { availability, factionById, resolveMode } from "../../lib/game-content";

export const metadata: Metadata = {
  title: "Download RTS AI | Red Alert 2 mod for OpenRA",
  description: "RTS AI is a Red Alert 2 mod for OpenRA with five modern nations and an AI co-commander. You need your own Red Alert 2; the mod imports it on first launch.",
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
    id: "hosted",
    icon: Cloud,
    title: "Hosted AI + local voice",
    badge: "Default",
    size: "Voice models about 270 MB",
    description: "The co-commander thinks on rtsai.net with Claude (Anthropic). Speech recognition and the voice run on your PC, so your audio is never uploaded. A free daily allowance, no account needed.",
    note: "Needs an internet connection. Offline or over the allowance, it falls back to alert lines.",
  },
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
    badge: "Smallest",
    size: "No model download",
    description: "Play the mod without the co-commander. Nothing is downloaded for AI and nothing is sent to rtsai.net.",
    note: "You can turn the co-commander on later in the game's settings.",
  },
] as const;

const requirements = [
  { icon: MonitorDown, label: "System", value: "Windows 10 or 11, 64-bit" },
  { icon: Disc3, label: "Game", value: "Your own Red Alert 2: Steam, EA app or disc" },
  { icon: Cpu, label: "Processor", value: "4-core x64 CPU with AVX2 for local voice and local AI" },
  { icon: MemoryStick, label: "Memory", value: "8 GB; 16 GB recommended for Full local AI" },
  { icon: HardDrive, label: "Storage", value: "About 5 GB free (6 GB with Full local AI), plus room for the Red Alert 2 files the mod imports" },
  { icon: Wifi, label: "Internet", value: "Needed for the download and for Hosted AI; skirmishes play offline" },
  { icon: Mic, label: "Microphone", value: "Optional, for push-to-talk questions" },
] as const;

export default async function DownloadPage({ searchParams }: { searchParams: Promise<{ faction?: string | string[]; mode?: string | string[] }> }) {
  const selection = await searchParams;
  const mode = resolveMode(selection.mode, "ra2");
  const faction = typeof selection.faction === "string" ? factionById(selection.faction) : undefined;
  const selectionStatus = faction ? availability(faction, mode) : undefined;
  const mod = getModRelease();
  const published = isPublished(mod) ? mod : null;
  const installer = windowsInstaller(mod);

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
      ? mode === "ra2" ? `${faction.name} is in RTS AI ${published?.version}` : `${faction.name} is in the previous Classic alpha`
      : selectionStatus === "Not in this mode"
        ? `${faction.name} is not in ${mode === "ra2" ? "Red Alert 2" : "Classic"}`
        : mode === "ra2" ? "RA2 release not yet certified" : "Not in the public Classic alpha";
  const selectionBody = !faction
    ? null
    : selectionStatus === "Not in this mode"
      ? "There is no implementation of this faction in this mode, and no download on this page adds one."
      : mode === "ra2"
        ? selectionStatus === "In public Windows release"
          ? "Download the Windows installer above. You still need your own Red Alert 2."
          : published
            ? `RTS AI ${published.version} is out, but ${faction.name} has not been verified in it yet.`
            : "The Red Alert 2 mod has no public release yet. The previous Classic alpha further down runs classic Red Alert and does not include RA2 factions."
        : selectionStatus === "In public Windows release"
          ? `Your Classic faction is part of the previous Classic alpha ${windowsRelease.version} for Windows below. Mac faction parity has not been separately certified.`
          : "This Classic faction is not certified in the public Classic alpha.";

  return (
    <>
      <SiteHeader />
      <main id="main-content">
        <header className="route-hero download-route-hero mod-download-hero">
          <span className="eyebrow">RTS AI / RED ALERT 2 MOD FOR OPENRA / WINDOWS</span>
          <h1>Bring Red Alert 2.<br /><em>We bring the rest.</em></h1>
          <div className="ra2-requirement" role="note" aria-label="Red Alert 2 required">
            <Disc3 size={22} aria-hidden="true" />
            <div><b>Red Alert 2 required</b><p>{RA2_REQUIREMENT}</p></div>
          </div>
          {published && installer ? (
            <>
              <a className="primary-action" href={installer.url} data-analytics-event="mod_download" data-platform="windows-x64-setup"><Download size={17} /> Download RTS AI {published.version} for Windows</a>
              <div className="release-trust" aria-label="Release details">
                <span><CalendarDays size={15} /> Released {formatDate(published.publishedAt)}</span>
                <span>{published.signed ? <ShieldCheck size={15} /> : <ShieldAlert size={15} />} {published.signed ? "Authenticode signed" : "Unsigned alpha"}</span>
                <span><FileArchive size={15} /> {formatBytes(installer.sizeBytes)} installer, SHA-256 below</span>
                <a href={published.releaseUrl}><ExternalLink size={15} /> Release on GitHub</a>
              </div>
            </>
          ) : (
            <div className="mod-coming-soon" role="status">
              <Hourglass size={20} aria-hidden="true" />
              <div>
                <b>First RTS AI mod release coming soon</b>
                <p>There is no public build of the Red Alert 2 mod yet, so there is nothing to download here today. Its Windows installer, file sizes and SHA-256 checksums will appear on this page when it is published.</p>
                <a className="text-action" href="#classic-alpha">See the previous Classic alpha</a>
              </div>
            </div>
          )}
        </header>

        {faction && (
          <aside className="release-selection" aria-label="Selected faction and release availability">
            <span className="section-number">{`${faction.name} / ${mode === "ra" ? "Classic" : "Red Alert 2"}`}</span>
            <h2>{selectionHeading}</h2>
            <p>{selectionBody}</p>
            <Link href={`/factions/${faction.id}?mode=${mode}`}>Back to the faction guide →</Link>
          </aside>
        )}

        <section className="download-section mod-setup" aria-labelledby="ai-choice-title">
          <div className="download-intro">
            <span className="section-number">01 / THE INSTALLER ASKS ONE QUESTION</span>
            <h2 id="ai-choice-title">How should your co-commander think?</h2>
            <p>Pick one when you install. You can switch later in the game&apos;s settings: AI Off, Local, or External (your own OpenAI-compatible endpoint). See <Link href="/privacy#ai-co-commander">what hosted AI sends</Link>.</p>
          </div>
          <div className="ai-choices">
            {aiChoices.map((choice) => (
              <article className={`ai-choice ${choice.id === "hosted" ? "is-default" : ""}`} key={choice.id}>
                <div className="platform-card-heading"><span className="platform-icon"><choice.icon size={22} /></span><div><span className="platform-kicker">{choice.size}</span><h3>{choice.title}</h3></div><span className={`release-status ${choice.id === "hosted" ? "is-ready" : ""}`}>{choice.badge}</span></div>
                <p>{choice.description}</p>
                <small>{choice.note}</small>
              </article>
            ))}
          </div>

          <div className="download-intro">
            <span className="section-number">02 / WINDOWS REQUIREMENTS</span>
            <h2>What your PC needs.</h2>
            <p>Windows ships first; macOS follows the first public mod release. These are the documented targets; a clean-machine hardware matrix is still being validated, so we do not promise AI response times.</p>
          </div>
          <dl className="mod-requirements">
            {requirements.map((item) => (
              <div key={item.label}><dt><item.icon size={15} aria-hidden="true" /> {item.label}</dt><dd>{item.value}</dd></div>
            ))}
          </dl>

          {published && !published.signed && (
            <div className="unsigned-note" role="note">
              <ShieldAlert size={18} aria-hidden="true" />
              <p><b>This alpha installer is not code-signed yet.</b> Windows SmartScreen may say &ldquo;Windows protected your PC&rdquo;. Before choosing More info, then Run anyway, check that the file&apos;s SHA-256 matches the one listed below: in PowerShell, run <code>Get-FileHash .\{installer?.name} -Algorithm SHA256</code>.</p>
            </div>
          )}
        </section>

        <section className="download-section mod-downloads" id="mod-downloads" aria-labelledby="mod-downloads-title">
          <div className="download-intro">
            <span className="section-number">03 / DOWNLOADS</span>
            <h2 id="mod-downloads-title">{published ? `RTS AI ${published.version}` : "First RTS AI mod release coming soon"}</h2>
            <p>{published ? "Every file comes from the public GitHub release. Compare its SHA-256 before you run it." : "No mod files are published yet, and we do not post placeholder links. Factions and the co-commander are in development; follow the faction guide in the meantime."}</p>
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
              <span className="pending-download" aria-disabled="true">Mod download not yet published</span>
              <Link className="text-action" href="/factions">Meet the five nations</Link>
            </div>
          )}
        </section>

        <section className="download-section classic-alpha" id="classic-alpha" aria-labelledby="classic-alpha-title">
          <div className="download-intro">
            <span className="section-number">{`PREVIOUS CLASSIC ALPHA / ${windowsRelease.version}`}</span>
            <h2 id="classic-alpha-title">Previous Classic alpha</h2>
            <p>OpenRA AI {windowsRelease.version} is the earlier public build. It runs on OpenRA&apos;s classic Red Alert, not Red Alert 2, with the co-commander and the Red Sea 2026 slice (Saudi Arabia and Yemen). It stays available as it is; it is not the RTS AI mod and needs no Red Alert 2.</p>
          </div>
          <div className="platform-downloads" aria-label="Previous Classic alpha downloads">
            <article className="platform-card is-pending">
              <div className="platform-card-heading"><span className="platform-icon"><MonitorDown size={23} /></span><div><span className="platform-kicker">Windows 10 / 11</span><h3>Classic alpha for Windows</h3></div><span className="release-status is-pending">{windowsRelease.authenticode === "verified" ? "Signed" : "Unsigned alpha"}</span></div>
              <p>{windowsRelease.authenticode === "verified" ? "An Authenticode-signed per-user setup." : "Checksum-verified but not Authenticode-signed, so SmartScreen may warn before launch."} Released {formatDate(windowsRelease.publishedAt)}.</p>
              <a className="secondary-download" href={classicWindowsUrl} data-analytics-event="game-download" data-platform="windows-x64-setup"><Download size={15} /> Classic alpha setup ({classicWindowsSize})</a>
              <div className="platform-meta">{windowsRelease.installerChecksumUrl && <a href={windowsRelease.installerChecksumUrl}>Setup checksum</a>}<a href={windowsRelease.url} data-analytics-event="game-download" data-platform="windows-x64-portable">Portable ZIP</a><a href={windowsRelease.checksumUrl}>ZIP checksum</a>{windowsRelease.aiPackUrl && <a href={windowsRelease.aiPackUrl} data-analytics-event="ai-pack-download" data-platform="windows-x64">Classic Local AI Pack ({classicAiPackSize})</a>}{windowsRelease.aiPackChecksumUrl && <a href={windowsRelease.aiPackChecksumUrl}>AI Pack checksum</a>}</div>
            </article>
            <article className="platform-card is-pending">
              <div className="platform-card-heading"><span className="platform-icon"><Apple size={23} /></span><div><span className="platform-kicker">Apple desktop</span><h3>Classic alpha for macOS</h3></div><span className="release-status is-pending">{gameRelease.macos ? "Notarized" : "Not available"}</span></div>
              {gameRelease.macos ? (
                <>
                  <p>{intelMacRelease ? "Signed and notarized disk images for Apple silicon and Intel." : "A signed and notarized disk image for Apple silicon."} Version {gameRelease.macos.version}.</p>
                  <div className="mac-download-actions">{appleSiliconRelease && <a className="secondary-download" href={appleSiliconRelease.url} data-analytics-event="game-download" data-platform="macos-arm64"><Download size={15} /> Apple silicon</a>}{intelMacRelease && <a className="secondary-download" href={intelMacRelease.url} data-analytics-event="game-download" data-platform="macos-x64">Intel Mac</a>}</div>
                  <div className="platform-meta">{appleSiliconRelease?.checksumUrl && <a href={appleSiliconRelease.checksumUrl}>Apple silicon checksum</a>}{intelMacRelease?.checksumUrl && <a href={intelMacRelease.checksumUrl}>Intel checksum</a>}</div>
                </>
              ) : (
                <><p>No signed macOS build of the Classic alpha is published.</p><span className="pending-download" aria-disabled="true">No placeholder download</span></>
              )}
            </article>
          </div>
          <div className="download-footnote"><BrainCircuit size={15} /><span>The Classic alpha keeps its own AI setup: an optional local model pack or an external provider you choose. Hosted AI and the installer choices above belong to the RTS AI mod.</span></div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

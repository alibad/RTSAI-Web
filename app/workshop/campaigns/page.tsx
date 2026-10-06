import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { SiteHeader, SiteFooter } from '../../components/SiteChrome';
import { CampaignStudio } from '../../components/CampaignStudio';
import { resolveMode, rosters } from '../../../lib/game-content';
import { flagSrc } from '../../../lib/faction-art';
import { ADMIN_BUILD } from '../../../lib/admin';
import '../workshop.css';
import './campaigns.css';

export const metadata: Metadata = { title: 'Campaign Story Builder | RTS AI', description: 'Build branching fictional campaigns, edit characters and mission objectives, generate animated mission-intro videos and playtest maps locally.', alternates: { canonical: '/workshop/campaigns' }, robots: { index: false, follow: false } };
// Admin tool: 404 in public builds, where vite.config.ts also stubs CampaignStudio out of the bundle (lib/admin.ts).
export default async function CampaignPage({ searchParams }: { searchParams: Promise<{ mode?: string | string[] }> }) {
  if (!ADMIN_BUILD) notFound();
  const mode = resolveMode((await searchParams).mode);
  const flags = Object.fromEntries(rosters.factions.flatMap(f => { const src = flagSrc(f.id); return src ? [[f.id, src]] : []; }));
  return <><SiteHeader/><main id="main-content" className="workshop-page campaign-page"><header className="workshop-intro"><div><span className="eyebrow">THE WORKSHOP / CAMPAIGNS</span><h1>Give the next mission a story.</h1></div><p>Write the people. Shape the choices. Set the scene.<br/>A local campaign studio for Red Alert 2 and Classic.</p></header><CampaignStudio initialMode={mode} flags={flags}/></main><SiteFooter/></>;
}

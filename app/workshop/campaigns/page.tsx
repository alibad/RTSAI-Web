import type { Metadata } from 'next';
import { SiteHeader, SiteFooter } from '../../components/SiteChrome';
import { CampaignStudio } from '../../components/CampaignStudio';
import { AdminGate } from '../../components/AdminGate';
import { resolveMode, rosters, standaloneRosters } from '../../../lib/game-content';
import { flagSrc } from '../../../lib/faction-art';
import '../workshop.css';
import './campaigns.css';

export const metadata: Metadata = { title: 'Campaign Story Builder | RTS AI', description: 'Build branching fictional campaigns, edit characters and mission objectives, generate animated mission-intro videos and playtest maps locally.', alternates: { canonical: '/workshop/campaigns' }, robots: { index: false, follow: false } };
// Admin tool that works anywhere (it keeps its drafts in the browser): the owner's on rtsai.net too (lib/admin.ts).
export default async function CampaignPage({ searchParams }: { searchParams: Promise<{ mode?: string | string[] }> }) {
  const mode = resolveMode((await searchParams).mode);
  const flags = Object.fromEntries(rosters.factions.flatMap(f => { const src = flagSrc(f.id); return src ? [[f.id, src]] : []; }));
  return <><SiteHeader/><AdminGate surface="campaigns"><main id="main-content" className="workshop-page campaign-page"><header className="workshop-intro"><div><span className="eyebrow">THE WORKSHOP / CAMPAIGNS</span><h1>Give the next mission a story.</h1></div><p>Write the people. Shape the choices. Set the scene.<br/>A local campaign studio for isometric and {standaloneRosters ? "standalone Classic catalog" : "historical Classic catalog"} experiments.</p></header><CampaignStudio initialMode={mode} flags={flags}/></main></AdminGate><SiteFooter/></>;
}

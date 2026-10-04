import type { Metadata } from 'next';
import { SiteHeader, SiteFooter } from '../../components/SiteChrome';
import { CampaignStudio } from '../../components/CampaignStudio';
import { resolveMode } from '../../../lib/game-content';
import '../workshop.css';
import './campaigns.css';

export const metadata: Metadata = { title: 'Campaign Story Builder | RTS AI', description: 'Build branching fictional campaigns, edit characters and mission objectives, generate animated mission-intro videos and playtest maps locally.', alternates: { canonical: '/workshop/campaigns' } };
export default async function CampaignPage({ searchParams }: { searchParams: Promise<{ mode?: string | string[] }> }) {
  const mode = resolveMode((await searchParams).mode);
  return <><SiteHeader/><main id="main-content" className="workshop-page campaign-page"><header className="workshop-intro"><div><span className="eyebrow">THE WORKSHOP / CAMPAIGNS</span><h1>Give the next mission a story.</h1></div><p>Write the people. Shape the choices. Set the scene.<br/>A local campaign studio for Red Alert 2 and Classic.</p></header><CampaignStudio initialMode={mode}/></main><SiteFooter/></>;
}

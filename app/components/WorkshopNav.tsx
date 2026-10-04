import Link from 'next/link';
import type { GameMode } from '../../lib/game-content';
export function WorkshopNav({ mode, active }: { mode: GameMode; active: 'map' | 'evals' | 'campaigns' }) {
  return <nav className="workshop-app-nav" aria-label="Workshop apps">{([['map', '/workshop', 'Map editor'], ['evals', '/workshop/evals', 'AI testing'], ['campaigns', '/workshop/campaigns', 'Campaign studio']] as const).map(([key, href, title]) => <Link key={key} href={`${href}?mode=${mode}`} aria-current={key === active ? 'page' : undefined}>{title}</Link>)}</nav>;
}

'use client';

import Link from 'next/link';
import type { GameMode } from '../../lib/game-content';
import { ADMIN_BUILD } from '../../lib/admin';
import { useAdmin } from './AdminGate';

// Campaign studio, AI testing and the AI Arena are admin tools: listed for the owner only (lib/admin.ts).
// "Map editor" is the game's own editor, not the old /workshop page (owner, 14 Oct and 16 Nov 2026), like the maker bar.
const apps = [['map', '/play/?mode=editor', 'Map editor', false], ['arena', '/workshop/arena', 'AI Arena', true], ['evals', '/workshop/evals', 'AI testing', true], ['campaigns', '/workshop/campaigns', 'Campaign studio', true]] as const;

export function WorkshopNav({ mode, active }: { mode: GameMode; active: 'map' | 'arena' | 'evals' | 'campaigns' }) {
  const { admin } = useAdmin();
  const shown = apps.filter(([, , , adminOnly]) => admin || !adminOnly);
  // In the local app the maker bar (MakerBar) lists these pages.
  if (ADMIN_BUILD || shown.length < 2) return null;
  return <nav className="workshop-app-nav" aria-label="Workshop apps">{shown.map(([key, href, title]) => key === 'map'
    // The game is its own app: it opens in a new tab (Classic with ?game=classic), and never shows as this page.
    ? <a key={key} href={mode === 'ra' ? '/play/?game=classic&mode=editor' : href} target="_blank" rel="noopener noreferrer">{title}</a>
    : <Link key={key} href={`${href}?mode=${mode}`} aria-current={key === active ? 'page' : undefined}>{title}</Link>)}</nav>;
}

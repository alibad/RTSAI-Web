'use client';

import Link from 'next/link';
import type { GameMode } from '../../lib/game-content';
import { ADMIN_BUILD } from '../../lib/admin';
import { useAdmin } from './AdminGate';

// Campaign studio, AI testing and the AI Arena are admin tools: listed for the owner only (lib/admin.ts).
const apps = [['map', '/workshop', 'Map editor', false], ['arena', '/workshop/arena', 'AI Arena', true], ['evals', '/workshop/evals', 'AI testing', true], ['campaigns', '/workshop/campaigns', 'Campaign studio', true]] as const;

export function WorkshopNav({ mode, active }: { mode: GameMode; active: 'map' | 'arena' | 'evals' | 'campaigns' }) {
  const { admin } = useAdmin();
  const shown = apps.filter(([, , , adminOnly]) => admin || !adminOnly);
  // In the local app the maker bar (MakerBar) lists these pages.
  if (ADMIN_BUILD || shown.length < 2) return null;
  return <nav className="workshop-app-nav" aria-label="Workshop apps">{shown.map(([key, href, title]) => <Link key={key} href={`${href}?mode=${mode}`} aria-current={key === active ? 'page' : undefined}>{title}</Link>)}</nav>;
}

import content from '../data/shared-content.generated.json';
import modifications from '../data/unit-modifications.generated.json';

export function sharedUnitStats(mode: 'classic' | 'ra2', actor: string): Partial<Record<'cost' | 'health' | 'speed', number>> {
  return (modifications.units as Record<string, Partial<Record<'cost' | 'health' | 'speed', number>>>)[`${mode}:${actor.toLowerCase()}`] ?? {};
}

/** A reviewed generated override, shared with engine builds. Bindings stay mode-specific. */
export function sharedUnitCost(mode: 'classic' | 'ra2', actor: string, fallback: number | null): number | null {
  const target = content.targets[mode === 'classic' ? 'classic-desktop' : 'ra2-web'];
  return sharedUnitStats(mode, actor).cost ?? (actor.toLowerCase() === target.actor.toLowerCase() ? target.cost : fallback);
}

export const sharedContentRevision = content.revision;

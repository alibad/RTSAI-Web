import content from '../data/shared-content.generated.json';

/** A reviewed generated override, shared with engine builds. Bindings stay mode-specific. */
export function sharedUnitCost(mode: 'classic' | 'ra2', actor: string, fallback: number | null): number | null {
  const target = content.targets[mode === 'classic' ? 'classic-desktop' : 'ra2-web'];
  return actor.toLowerCase() === target.actor.toLowerCase() ? target.cost : fallback;
}

export const sharedContentRevision = content.revision;

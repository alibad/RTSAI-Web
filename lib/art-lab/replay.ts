/** Pure replay math. Only positions/yaw are interpolated; health and membership stay measured steps. */
import type { DuelSample } from "./duel-server";
export const angleDelta = (from: number, to: number) => ((to - from + 1536) % 1024) - 512;
export const facingToward = (dx: number, dy: number) => (Math.round(768 - Math.atan2(dy, dx) * 1024 / (2 * Math.PI)) + 1024) % 1024;
export function sampleIndex(samples: DuelSample[], tick: number) {
  let lo = 0, hi = Math.max(0, samples.length - 1);
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (samples[mid].tick <= tick) lo = mid; else hi = mid - 1; }
  return lo;
}
export function replaySample(samples: DuelSample[], tick: number): DuelSample | null {
  if (!samples.length) return null;
  const index = sampleIndex(samples, tick), a = samples[index], b = samples[Math.min(index + 1, samples.length - 1)];
  const t = Math.max(0, Math.min(1, (tick - a.tick) / Math.max(1, b.tick - a.tick)));
  const lerp = (x: number, y: number) => x + (y - x) * t;
  const actors = a.actors.map(p => { const q = b.actors.find(q => q.side === p.side && q.index === p.index); return q ? { ...p, x: lerp(p.x, q.x), y: lerp(p.y, q.y), z: lerp(p.z, q.z), facing: (p.facing + angleDelta(p.facing, q.facing) * t + 1024) % 1024, ...(p.turretFacing!==undefined&&p.turretFacing>=0&&q.turretFacing!==undefined&&q.turretFacing>=0?{turretFacing:(p.turretFacing+angleDelta(p.turretFacing,q.turretFacing)*t+1024)%1024}:{}) } : p; });
  const wrecks = (a.wrecks ?? []).map((p, i) => { const q = b.wrecks?.[i]; return q && q.side === p.side && q.type === p.type ? { ...p, x: lerp(p.x, q.x), y: lerp(p.y, q.y), z: lerp(p.z, q.z), facing: (p.facing + angleDelta(p.facing, q.facing) * t + 1024) % 1024 } : p; });
  return { tick, actors, wrecks };
}
export function replayBounds(samples: DuelSample[], project: (x: number, y: number, z?: number) => number[]) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const s of samples) for (const p of [...s.actors, ...s.wrecks ?? []]) for (const z of [0,p.z]) { const [x,y] = project(p.x,p.y,z); minX = Math.min(minX,x); maxX = Math.max(maxX,x); minY = Math.min(minY,y); maxY = Math.max(maxY,y); }
  return Number.isFinite(minX) ? { minX, maxX, minY, maxY } : { minX:-150,maxX:150,minY:-80,maxY:80 };
}
/** Last observed actor before an event, even after it disappears from later samples. */
export function eventActor(samples: DuelSample[], tick: number, side: number, index: number) {
  for (let i = sampleIndex(samples, tick); i >= 0; i--) { const p = samples[i].actors.find(p => p.side === side && p.index === index); if (p) return p; }
  return null;
}

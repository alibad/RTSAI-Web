"use client";
/**
 * Admin-only additions to the Faction viewer (the local app and dev): a link into the Studio and a tucked-away
 * History of the unit's earlier art. Public builds replace this module with an empty stub (vite.config.ts), so none
 * of it, nor the dev API it reads, reaches rtsai.net.
 */
import { useEffect, useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import type { PreviewActor, PreviewStatus } from "../../../../lib/art-lab/chain";
import { archivedCandidate, historyFileUrl, type HistoryEntry } from "../../../../lib/art-lab/installed-art";
import { voxelBaseSpec, type UnitWorkspace } from "../../../../lib/art-lab/review";
import type { ViewerUnit } from "../../../../lib/viewer";
import type { FrameStore, StageItem } from "../review/frames";
import { UnitHistory } from "../review/History";
import { stageItem, type ReviewUnit } from "../review/versions";

export type ShownVersion = { item: StageItem; label: string };
const API = "/api/art-review";

export function ViewerAdmin({ unit, factionId, factionName, frames, onShow }: {
  unit: ViewerUnit; factionId: string; factionName: string; frames: FrameStore; onShow: (shown: ShownVersion | null) => void;
}) {
  const [data, setData] = useState<{ ws: UnitWorkspace | undefined; entry: PreviewActor | undefined } | null>(null);
  useEffect(() => {
    let live = true;
    const get = <T,>(path: string) => fetch(`${API}/${path}`, { cache: "no-store" }).then(r => (r.ok ? r.json() as Promise<T> : null)).catch(() => null);
    void Promise.all([get<{ unit?: UnitWorkspace }>(`unit?mode=ra2&actor=${encodeURIComponent(unit.id)}`), get<PreviewStatus>("preview?mode=ra2")])
      .then(([u, p]) => { if (live) setData({ ws: u?.unit, entry: p?.actors?.[unit.id] }); });
    return () => { live = false; };
  }, [unit.id]);
  const review: ReviewUnit | null = useMemo(() => (unit.art ? {
    id: unit.id, factionId, factionName, name: unit.name, category: unit.category, role: unit.role, catalog: null, queue: "", order: 0,
    spec: unit.art.spec, sprite: unit.art.sprite, ...(unit.art.spec.voxel ? {} : { voxelBase: voxelBaseSpec(unit.art.spec) }),
  } : null), [unit, factionId, factionName]);
  if (!review) return null;
  const show = (e: HistoryEntry) => {
    const candidate = e.candidate ? data?.ws?.candidates.find(c => c.id === e.candidate) ?? null : archivedCandidate(unit.id, e, historyFileUrl(unit.id));
    const item = e.release ? stageItem(review, null) : candidate ? stageItem(review, candidate) : null;
    if (item) onShow({ item, label: e.label });
  };
  return (
    <section className="viewer-admin" aria-label="Admin">
      <a className="viewer-admin-link" href={`/art/review?mode=ra2&faction=${encodeURIComponent(factionId)}&unit=${encodeURIComponent(unit.id)}`}>Open in the Studio<ExternalLink size={13} aria-hidden="true" /></a>
      {data && <UnitHistory unit={review} ws={data.ws} entry={data.entry} frames={frames} tints={[]} onShow={show} showable={e => e.slot === "model"} />}
    </section>
  );
}

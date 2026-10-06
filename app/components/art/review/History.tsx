"use client";
/* Historical pictures come from the local dev routes (RTSAI-Art files, the release cache); next/image cannot serve them. */
/* eslint-disable @next/next/no-img-element */
import { memo, useEffect, useMemo, useState } from "react";
import { Eye } from "lucide-react";
import { HISTORY_ROUTE, historyFor, type ArchivedArt, type HistoryEntry } from "../../../../lib/art-lab/installed-art";
import type { PreviewActor } from "../../../../lib/art-lab/chain";
import type { UnitWorkspace } from "../../../../lib/art-lab/review";
import type { MapTint } from "../viewSettings";
import type { FrameStore } from "./frames";
import { ModelThumb } from "./Filmstrip";
import { stageItem, type ReviewUnit } from "./versions";

const archives = new Map<string, Promise<ArchivedArt[]>>();
function archiveOf(actor: string): Promise<ArchivedArt[]> {
  if (!archives.has(actor)) {
    archives.set(actor, fetch(`${HISTORY_ROUTE}?actor=${encodeURIComponent(actor)}`, { cache: "no-store" })
      .then(r => (r.ok ? r.json() : { archive: [] })).then((j: { archive?: ArchivedArt[] }) => j.archive ?? []).catch(() => []));
  }
  return archives.get(actor)!;
}

function Entry({ e, unit, ws, frames, tints, onShow }: { e: HistoryEntry; unit: ReviewUnit; ws: UnitWorkspace | undefined; frames: FrameStore; tints: MapTint[]; onShow: (e: HistoryEntry) => void }) {
  // Models draw as the stage draws them (the same cached frames the filmstrip uses), not as contact sheets.
  const candidate = e.slot === "model" && e.candidate ? ws?.candidates.find(c => c.id === e.candidate) ?? null : null;
  const releaseModel = e.slot === "model" && (e.release || candidate) ? stageItem(unit, candidate)
    : e.previous && unit.previousArt ? stageItem({ ...unit, id: `${unit.id}:previous`, spec: unit.previousArt.spec, sprite: unit.previousArt.sprite }, null) : null;
  const canShow = Boolean(e.release || e.candidate);
  return (
    <li className="history-entry">
      <span className="history-pic">
        {releaseModel ? <ModelThumb item={releaseModel} frames={frames} tints={tints} zoom={1} width={72} height={56} radius={null} />
          : e.image ? <img src={e.image} alt="" loading="lazy" decoding="async" draggable={false} className={e.slot === "icon" ? "is-pixel" : undefined} />
          : <span className="history-nopic">{e.slot === "icon" ? "PNG" : "Model"}</span>}
      </span>
      <span className="history-text">
        <b>{e.label}</b>
        <small>{[e.generator, e.date].filter(Boolean).join(" · ") || "Generator not recorded"}</small>
        {e.file && <code title={e.file}>{e.file}</code>}
      </span>
      {canShow && <button type="button" className="lab-ghost history-show" title="Show on the stage (as the version it was, never as current)" aria-label={`Show ${e.label} on the stage`} onClick={() => onShow(e)}><Eye size={14} aria-hidden="true" /></button>}
    </li>
  );
}

/**
 * Admin-only, tucked away under the inspector: every earlier picture and model of the unit, labelled Historical.
 * Nothing loads until it is opened; nothing here can be chosen or decided.
 */
export const UnitHistory = memo(function UnitHistory({ unit, ws, entry, frames, tints, onShow }: {
  unit: ReviewUnit; ws: UnitWorkspace | undefined; entry: PreviewActor | undefined; frames: FrameStore; tints: MapTint[]; onShow: (e: HistoryEntry) => void;
}) {
  const [open, setOpen] = useState(false);
  const [archive, setArchive] = useState<{ actor: string; list: ArchivedArt[] } | null>(null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    void archiveOf(unit.id).then(list => { if (live) setArchive({ actor: unit.id, list }); });
    return () => { live = false; };
  }, [open, unit.id]);
  const entries = useMemo(() => (open ? historyFor({
    actor: unit.id, ws, entry,
    release: { cameo: unit.spec.cameo, hasModel: Boolean(unit.spec.voxel || unit.sprite), sources: unit.releaseSources ?? unit.sources },
    archive: archive?.actor === unit.id ? archive.list : [], previous: unit.previous,
  }) : []), [open, unit, ws, entry, archive]);
  const icons = entries.filter(e => e.slot === "icon"), models = entries.filter(e => e.slot === "model");
  return (
    <details className="studio-history" onToggle={e => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>History</summary>
      {open && (
        <div className="history-body">
          <p className="lab-hint">Earlier art for {unit.name}. Historical only: none of it is what the game plays.</p>
          {!entries.length && <p className="lab-hint">No earlier art recorded.</p>}
          {entry?.released && archive?.actor === unit.id && !archive.list.length && <p className="lab-hint">Promoted. The archive under RTSAI-Art/history/{unit.id}/ is empty so far, so the release it replaced comes from the last synced art manifest.</p>}
          {icons.length > 0 && <><h4>Icons · {icons.length}</h4><ul>{icons.map(e => <Entry key={e.key} e={e} unit={unit} ws={ws} frames={frames} tints={tints} onShow={onShow} />)}</ul></>}
          {models.length > 0 && <><h4>Game models · {models.length}</h4><ul>{models.map(e => <Entry key={e.key} e={e} unit={unit} ws={ws} frames={frames} tints={tints} onShow={onShow} />)}</ul></>}
        </div>
      )}
    </details>
  );
});

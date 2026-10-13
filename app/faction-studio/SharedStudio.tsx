"use client";

import { useEffect, useState, type ComponentType } from "react";
import type { ReviewUnit } from "../components/art/review/versions";
import type { MapTint } from "../components/art/viewSettings";
import { EA_NOTICE, installSnapshotApi, type StudioSnapshotIndex } from "../../lib/art-lab/studio-snapshot";

type Studio = ComponentType<{ units: ReviewUnit[]; tints: MapTint[]; shared?: boolean }>;

/** The Faction Studio as everyone can open it: the published snapshot, read-only. The app screen loads in the browser only. */
export function SharedStudio({ index, units, tints }: { index: string | null; units: ReviewUnit[]; tints: MapTint[] }) {
  const [Studio, setStudio] = useState<{ App: Studio } | null>(null), [error, setError] = useState("");
  useEffect(() => {
    if (!index) return;
    let cancelled = false;
    fetch(index)
      .then(r => (r.ok ? r.json() as Promise<StudioSnapshotIndex> : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(async snapshot => {
        if (cancelled) return;
        installSnapshotApi(snapshot);
        const { ReviewApp } = await import("../components/art/ReviewApp");
        if (!cancelled) setStudio({ App: ReviewApp });
      })
      .catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { cancelled = true; };
  }, [index]);
  return (
    <div className="shared-studio">
      {!index ? <p className="lab-empty">The Faction Studio has not been published yet.</p>
        : error ? <p className="lab-empty">The Faction Studio could not load ({error}). Try again in a moment.</p>
        : !Studio ? <p className="lab-empty">Loading the Faction Studio…</p>
        : <Studio.App units={units} tints={tints} shared />}
      <p className="shared-studio-notice">
        Original Command &amp; Conquer art is shown under EA’s free, non-commercial modding guidelines. {EA_NOTICE} Other
        mods’ art belongs to their authors and is credited beside each unit (Sources).
      </p>
    </div>
  );
}

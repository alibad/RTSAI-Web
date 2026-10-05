"use client";
/* Concept and GLB thumbnails come from the local dev route; next/image cannot serve them. */
/* eslint-disable @next/next/no-img-element */
import { memo } from "react";
import { Box, Check, Minus, X } from "lucide-react";
import { chainSteps, checksSummary, type ActionCheck, type ChainStep, type DecisionState, type Design, type RosterCounts } from "../../../../lib/art-lab/chain";
import type { MeasuredGroup } from "../../../../lib/art-lab/measurements";
import type { ModelOption } from "../../../../lib/art-lab/models";
import type { Candidate } from "../../../../lib/art-lab/review";
import type { MapTint } from "../viewSettings";
import type { FrameStore, StageItem } from "./frames";
import { ModelThumb } from "./Filmstrip";
import { glbSnapshot, useGlbSnapshots } from "./GlbStage";

export type ChainData = {
  current: { item: StageItem | null; tag: string };
  design: Design | null;
  glb: { options: ModelOption[] };
  game: { candidate: Candidate | null; item: StageItem | null; tag: string; fromGlb: boolean; count: number; preview: boolean; light: string | null };
  actions: ActionCheck[];
  checks: MeasuredGroup[];
  decision: DecisionState;
};

const THUMB_W = 96, THUMB_H = 52;

function Missing() { return <span className="chain-missing" aria-hidden="true" />; }

/**
 * The actor's whole art chain in one row: what the game draws today, the design, the 3D model, the native game
 * model made from it, its animations, the measured checks and your decision. Each step opens on the stage.
 */
export const AssetChain = memo(function AssetChain({ data, step, onStep, frames, tints, zoom, radius }: {
  data: ChainData; step: ChainStep | null; onStep: (step: ChainStep) => void; frames: FrameStore; tints: MapTint[]; zoom: number; radius: number | null;
}) {
  useGlbSnapshots();
  const glb = data.glb.options[0] ?? null;
  // The pre-rendered picture (npm run thumbs:glb) when it matches the model; else the one taken on first view.
  const snapshot = glb?.thumbnail ?? glbSnapshot(glb?.url);
  const present = data.actions.filter(a => a.present).length;
  const checks = checksSummary(data.checks);
  const cells: Record<ChainStep, { thumb: React.ReactNode; state: string; status: "ok" | "missing" | "open" | "good" | "bad"; badge?: string }> = {
    now: {
      thumb: data.current.item ? <ModelThumb item={data.current.item} frames={frames} tints={tints} zoom={zoom} width={THUMB_W} height={THUMB_H} radius={radius} /> : <Missing />,
      state: `${data.current.tag} · in game`, status: "ok",
    },
    design: {
      thumb: data.design ? <img className="is-contain" src={data.design.thumb} alt="" loading="lazy" decoding="async" draggable={false} /> : <Missing />,
      state: data.design ? "Concept" : "None yet", status: data.design ? "ok" : "missing",
    },
    glb: {
      thumb: snapshot ? <img src={snapshot} alt="" draggable={false} /> : glb ? <span className="chain-glyph"><Box size={22} aria-hidden="true" /></span> : <Missing />,
      state: glb ? (glb.triangles ? `GLB · ${Math.round(glb.triangles / 1000)}k tris` : "GLB ready") : "None yet", status: glb ? "ok" : "missing",
    },
    game: {
      thumb: data.game.item ? <ModelThumb item={data.game.item} frames={frames} tints={tints} zoom={zoom} width={THUMB_W} height={THUMB_H} radius={radius} /> : <Missing />,
      state: data.game.candidate ? `${data.game.tag}${data.game.fromGlb ? " from 3D" : " · older route"}` : "Not made yet",
      status: data.game.candidate ? "ok" : "missing", badge: data.game.preview ? "In local preview" : undefined,
    },
    anim: {
      thumb: data.actions.length ? <span className="chain-figure">{present}<small>/{data.actions.length}</small></span> : <Missing />,
      state: !data.actions.length ? "Nothing to play" : present === data.actions.length ? "All present" : `No ${data.actions.filter(a => !a.present).map(a => a.label.toLowerCase()).join(", ")}`,
      status: !data.actions.length ? "missing" : present === data.actions.length ? "ok" : "open",
    },
    checks: {
      thumb: checks.state === "none" ? <Missing /> : <span className={`chain-figure${checks.state === "fail" ? " is-bad" : checks.state === "pass" ? " is-good" : ""}`}>{checks.total ? <>{checks.passed}<small>/{checks.total}</small></> : checks.state === "fail" ? "✕" : checks.state === "pass" ? "✓" : "–"}</span>,
      state: checks.state === "none" ? (data.game.candidate ? "Not measured yet" : "Nothing to check") : checks.state === "fail" ? `${checks.failing} failing` : checks.state === "pass" ? "All passed" : "No stock comparison yet",
      status: checks.state === "none" ? "missing" : checks.state === "fail" ? "bad" : checks.state === "pass" ? "good" : "open",
    },
    call: {
      thumb: <span className={`chain-call is-${data.decision.kind}`}>{data.decision.kind === "use" ? <Check size={22} strokeWidth={3} /> : data.decision.kind === "keep" ? <Minus size={22} strokeWidth={3} /> : data.decision.kind === "rejected" ? <X size={22} strokeWidth={3} /> : <span className="chain-dot" />}</span>,
      state: data.decision.label, status: data.decision.kind === "use" ? "good" : data.decision.kind === "rejected" ? "bad" : data.decision.kind === "open" ? "open" : data.decision.kind === "none" ? "missing" : "ok",
    },
  };
  return (
    <ol className="chain" aria-label="Asset chain">
      {chainSteps.map((s, i) => {
        const cell = cells[s.id];
        return (
          <li key={s.id} className={`chain-step is-${cell.status}${step === s.id ? " is-active" : ""}`}>
            <button type="button" aria-current={step === s.id ? "step" : undefined} onClick={() => onStep(s.id)} title={`${s.label} (${i + 1})`}>
              <span className="chain-thumb">{cell.thumb}{cell.badge && <span className="chain-badge">{cell.badge}</span>}</span>
              <span className="chain-text"><b>{s.label}</b><small>{cell.state}</small></span>
              <kbd aria-hidden="true">{i + 1}</kbd>
            </button>
          </li>
        );
      })}
    </ol>
  );
});

/** Roster progress, one actor per count, always over the same denominator. */
export function RosterTally({ counts }: { counts: RosterCounts | null }) {
  if (!counts?.total) return null;
  const items: [string, number, string][] = [
    ["3D models", counts.models3d, "Actors with a generated 3D model (GLB)"],
    ["Game models", counts.gameModels, "Actors with a native VXL/SHP candidate made from that 3D model"],
    ["In preview", counts.inPreview, "Actors whose candidate is installed in the local preview mod"],
    ["Decided", counts.decided, "Actors whose battlefield model you have decided"],
  ];
  return (
    <div className="chain-tally" aria-label="New roster progress">
      {items.map(([label, n, title]) => (
        <span key={label} title={`${title}: ${n} of ${counts.total}`}>
          <i style={{ ["--done" as string]: n / counts.total }} aria-hidden="true" />
          <b>{n}</b><small>/{counts.total}</small> {label}
        </span>
      ))}
    </div>
  );
}

"use client";
import { Volume1, Volume2, VolumeX } from "lucide-react";
import { soundEngine, useSoundPrefs } from "./sound";

/** Mute and volume for every Studio sound, remembered in this browser. */
export function SoundControls() {
  const { muted, volume } = useSoundPrefs();
  const Icon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  return (
    <div className="studio-sound" role="group" aria-label="Sound">
      <button type="button" className="lab-ghost" aria-pressed={!muted} onClick={() => soundEngine.setPrefs({ muted: !muted })} title={muted ? "Sound off: click to turn it on" : "Sound on: click to mute"}>
        <Icon size={16} aria-hidden="true" /><span className="sr-only">{muted ? "Unmute" : "Mute"}</span>
      </button>
      <input type="range" aria-label="Volume" min={0} max={1} step={0.05} value={volume} disabled={muted} onChange={e => soundEngine.setPrefs({ volume: Number(e.target.value) })} />
    </div>
  );
}

/** Local preview contract; never inferred from arbitrary media URLs. */
export type HangarAudioPreview = { revision: string; name: string; actor: string; faction: string; event: string; url: string; loop: boolean };
export const HANGAR_AUDIO_EVENTS: Record<string, string> = {
  "main-gun": "weapon:report", impact: "weapon:impact", destruction: "death:explosion",
  "voice-select": "voice:Select", "voice-move": "voice:Move", "voice-attack": "voice:Attack", "voice-under-fire": "voice:Feedback",
};
export const loopbackHost = (host: string) => ["127.0.0.1", "localhost", "[::1]"].includes(host);
export function validHangarPreview(value: unknown, revision: string, actor: string, faction: string, port: string): value is HangarAudioPreview {
  if (!value || typeof value !== "object" || !/^[a-f0-9-]{36}$/.test(revision) || !/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) return false;
  const p = value as HangarAudioPreview;
  if (p.revision !== revision || p.actor !== actor || p.faction !== faction || typeof p.name !== "string" || p.name.length > 160 || !(p.event in HANGAR_AUDIO_EVENTS || p.event === "engine") || typeof p.loop !== "boolean") return false;
  try { const url = new URL(p.url); return url.protocol === "http:" && loopbackHost(url.hostname) && url.port === port && url.pathname === `/api/audio-lab/asset/${revision}.wav` && !url.search && !url.hash && !url.username && !url.password; } catch { return false; }
}

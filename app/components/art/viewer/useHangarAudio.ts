"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { loopbackHost, validHangarPreview, type HangarAudioPreview } from "../../../../lib/hangar-audio";

/** A candidate is enabled only after its actual bytes are reachable. Failure leaves game sounds intact. */
const subscribe = () => () => {};
const localSnapshot = () => loopbackHost(window.location.hostname);
const serverSnapshot = () => false;
export function useHangarAudio(actor: string | null, faction: string) {
  const [preview, setPreview] = useState<HangarAudioPreview | null>(null), [error, setError] = useState("");
  const local = useSyncExternalStore(subscribe, localSnapshot, serverSnapshot);
  const [enabled, setEnabled] = useState(true), [port, setPort] = useState("8003");
  useEffect(() => {
    const isLocal = loopbackHost(window.location.hostname);
    if (!isLocal || !actor) return;
    const query = new URLSearchParams(window.location.search), id = query.get("hangarRevision"), requestedPort = query.get("hangarPort") ?? "8003";
    if (!id || !/^[a-f0-9-]{36}$/.test(id) || !/^\d{1,5}$/.test(requestedPort) || Number(requestedPort) < 1 || Number(requestedPort) > 65535) return;
    const controller = new AbortController(); let live = true; let probe: HTMLAudioElement | null = null;
    fetch(`http://127.0.0.1:${requestedPort}/api/audio-lab/preview/${id}`, { signal: controller.signal }).then(async r => { if (!r.ok) throw new Error("Hangar revision unavailable. Playing current game sounds."); return r.json(); }).then(value => {
      if (!validHangarPreview(value, id, actor, faction, requestedPort)) throw new Error("This revision does not match the selected unit. Playing current game sounds.");
      probe = new Audio(); probe.preload = "metadata";
      return new Promise<HangarAudioPreview>((resolve, reject) => { const timeout = setTimeout(() => reject(new Error("Preview audio unavailable. Playing current game sounds.")), 8000); probe!.onloadedmetadata = () => { clearTimeout(timeout); resolve(value); }; probe!.onerror = () => { clearTimeout(timeout); reject(new Error("Preview audio unavailable. Playing current game sounds.")); }; controller.signal.addEventListener("abort", () => { clearTimeout(timeout); reject(new Error("Cancelled")); }, { once: true }); probe!.src = value.url; });
    }).then(p => { if (live) { setPreview(p); setError(""); setPort(requestedPort); setEnabled(true); } }).catch(e => { if (live && !controller.signal.aborted) setError(e.message); });
    return () => { live = false; controller.abort(); probe?.removeAttribute("src"); };
  }, [actor, faction]);
  const clear = () => { setPreview(null); setError(""); const url = new URL(window.location.href); url.searchParams.delete("hangarRevision"); url.searchParams.delete("hangarPort"); window.history.replaceState({}, "", url.href); };
  const requested = local ? new URLSearchParams(window.location.search).get("hangarRevision") : null;
  const matching = preview?.actor === actor && preview?.faction === faction && preview?.revision === requested ? preview : null;
  return { preview: enabled ? matching : null, savedPreview: matching, error: requested ? error : "", local, enabled, setEnabled, clear, port };
}

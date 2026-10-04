"use client";
import { useEffect, useState } from "react";
import { validImagePlayerColor } from "../../../../lib/art-lab/image-remap";
import { useLab } from "./lab-store";
import type { Version } from "./versions";

export function usePlayerColorImage(version: Version) {
  const color = useLab(s => s.color);
  const mask = version.candidate?.playerColor;
  const supported = validImagePlayerColor(mask) && mask.image === version.candidate?.files.concept;
  const [result, setResult] = useState<{ key: string; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = `${version.image}|${color}|${JSON.stringify(mask)}`;
  useEffect(() => {
    if (!color || !supported || !version.image) return;
    let disposed = false, objectUrl: string | null = null;
    const worker = new Worker(new URL("../../../../lib/art-lab/image-remap-worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<{ blob?: Blob; error?: string }>) => {
      if (disposed) return;
      if (e.data.error) { setError(e.data.error); return; }
      if (e.data.blob) { objectUrl = URL.createObjectURL(e.data.blob); setResult({ key, url: objectUrl }); setError(null); }
    };
    worker.onerror = () => { if (!disposed) setError("Player color preview unavailable"); };
    void fetch(version.image).then(r => { if (!r.ok) throw new Error("Image could not be loaded"); return r.blob(); })
      .then(createImageBitmap).then(bitmap => { if (disposed) bitmap.close(); else worker.postMessage({ bitmap, mask, color }, [bitmap]); })
      .catch(e => { if (!disposed) setError(e.message); });
    return () => { disposed = true; worker.terminate(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [key, color, supported, version.image, mask]);
  return { image: result?.key === key ? result.url : version.image, supported, error };
}

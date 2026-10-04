import { createHash } from "node:crypto";
import type { AssetSource } from "./asset-source";
import type { ProvenanceRecord } from "./provenance";
/** A mod folder or a generated-looking name is not proof of origin. Check exact provenance bytes. */
export function localAssetSource(file: string, mode: "ra2" | "classic", path: string | undefined, bytes: () => Uint8Array, record: ProvenanceRecord | null): AssetSource {
  const game=mode==="ra2"?"Red Alert 2 / Yuri’s Revenge":"Red Alert";
  if(!path&&!file.startsWith("owned/"))return {kind:"original-game",label:"Original game",pack:game,creator:"EA / Westwood",file,evidence:"local-game-files",rights:"original-game-data"};
  const pack=mode==="ra2"?"RTS AI · RA2":"RTS AI · Classic";
  const key=path?.replace(/^mods\/(?:rtsai|ra)\/modern-factions\//,"");
  const entry=key&&record?.files?.[key];
  if(entry){
    const sha256=createHash("sha256").update(bytes()).digest("hex");
    if(sha256===entry.sha256){
      const kind=entry.origin==="generated"?"generated":["procedural","rendered-from-project-geometry"].includes(entry.origin)?"project-created":null;
      if(kind)return {kind,label:kind==="generated"?"AI generated":"Project created",pack,creator:"RTS AI project",tool:entry.generation?.model??entry.generator,file:path,sha256,source:entry.source,evidence:"hash-verified",rights:"project-record"};
    }
  }
  return {kind:"unknown",label:"Source unverified",pack,creator:null,file:path??file,evidence:"unknown",rights:"unreviewed"};
}

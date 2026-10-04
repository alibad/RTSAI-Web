/** Attribution is per artwork slot. Faction identity and a cache path never establish authorship. */
export type AssetSource = {
  kind: "original-game" | "generated" | "project-created" | "third-party" | "modified-game" | "mixed" | "unknown";
  label: string;
  pack: string;
  creator: string | null;
  tool?: string;
  file?: string;
  sha256?: string;
  source?: { repo: string; path: string; commit: string };
  evidence: "hash-verified" | "local-game-files" | "mixed-verified" | "declared" | "unknown";
  rights: "original-game-data" | "project-record" | "unreviewed";
};
export type ActorSources = { model: AssetSource; icon: AssetSource; files: AssetSource[]; rules: string };
export function combineSources(sources: AssetSource[], pack: string): AssetSource {
  if (!sources.length) return { kind: "unknown", label: "Source unknown", pack, creator: null, evidence: "unknown", rights: "unreviewed" };
  const kinds=new Set(sources.map(s=>s.kind)),creators=new Set(sources.map(s=>s.creator)),tools=[...new Set(sources.flatMap(s=>s.tool?[s.tool]:[]))];
  const same=kinds.size===1&&new Set(sources.map(s=>s.pack)).size===1;
  return {...sources[0],kind:same?sources[0].kind:"mixed",label:same?sources[0].label:"Mixed sources",pack:new Set(sources.map(s=>s.pack)).size===1?sources[0].pack:pack,creator:creators.size===1?sources[0].creator:null,tool:tools.join(" · ")||undefined,file:undefined,sha256:undefined,source:undefined,evidence:sources.every(s=>s.evidence==="hash-verified")?"hash-verified":sources.every(s=>s.evidence==="local-game-files")?"local-game-files":sources.every(s=>["hash-verified","local-game-files"].includes(s.evidence))?"mixed-verified":"unknown",rights:sources.every(s=>s.rights==="project-record")?"project-record":sources.every(s=>s.rights==="original-game-data")?"original-game-data":"unreviewed"};
}
export function sourceLabel(unit: {sources?: ActorSources;origin?: string}) {
  return unit.sources?.model.label ?? (unit.origin==="original"?"Original game":unit.origin==="modified"?"Modified game art":"Source unverified");
}

export type ModSource = { id: string; name: string; engine: "OpenRA" | "RA2 / Yuri’s Revenge"; url: string; checkedAt: string; importStatus: "not-imported"; artRights: "not-reviewed"; note: string };
/** Verified project links, not a claim that their assets or factions have been imported or licensed. */
export const modSources: ModSource[] = [
  {id:"openra-ra2",name:"OpenRA Red Alert 2",engine:"OpenRA",url:"https://github.com/OpenRA/ra2",checkedAt:"2026-10-04",importStatus:"not-imported",artRights:"not-reviewed",note:"RA2 implementation. Original game data remains separate from the mod."},
  {id:"romanovs-vengeance",name:"Romanov’s Vengeance",engine:"OpenRA",url:"https://github.com/MustaphaTR/Romanovs-Vengeance",checkedAt:"2026-10-04",importStatus:"not-imported",artRights:"not-reviewed",note:"RA2 mod. Its roster, custom traits and individual artwork credits need an import adapter."},
  {id:"combined-arms",name:"Combined Arms",engine:"OpenRA",url:"https://github.com/Inq8/CAmod",checkedAt:"2026-10-04",importStatus:"not-imported",artRights:"not-reviewed",note:"Community OpenRA mod. Engine compatibility and per-asset credits need review."},
  {id:"mental-omega",name:"Mental Omega",engine:"RA2 / Yuri’s Revenge",url:"https://www.moddb.com/mods/mental-omega",checkedAt:"2026-10-04",importStatus:"not-imported",artRights:"not-reviewed",note:"Original-engine mod. Artwork may be previewable, but Ares/INI behavior is not OpenRA behavior."},
];

import type { Metadata } from "next";
import { WorkshopNav } from "../components/WorkshopNav";
import { SiteHeader, SiteFooter } from "../components/SiteChrome";
import { MapWorkshop } from "../components/MapWorkshop";
import { resolveMode, rosters } from "../../lib/game-content";
import { flagSrc } from "../../lib/faction-art";
import "./workshop.css";
import "./campaigns/campaigns.css";

export const metadata:Metadata={title:"Map Workshop | RTS AI",description:"Generate terrain, place every faction's units and buildings, and experiment with browser battles. Save scenes and export maps for OpenRA.",alternates:{canonical:"/workshop"}};
export default async function WorkshopPage({searchParams}:{searchParams:Promise<{mode?:string|string[];campaign?:string}>}){
  const params=await searchParams,mode=resolveMode(params.mode);
  // National flags for the faction picker (public/faction-art; the art manifest stays on the server).
  const flags=Object.fromEntries(rosters.factions.flatMap(f=>{const src=flagSrc(f.id);return src?[[f.id,src]]:[];}));
  return <><SiteHeader/><main id="main-content" className="workshop-page"><header className="workshop-intro"><div><span className="eyebrow">THE WORKSHOP</span><h1>Build your battlefield.</h1></div><p>Shape the terrain. Place your forces. Play out an idea.<br/>A local experiment space for RTS AI and the Classic add-on.</p></header><WorkshopNav mode={mode} active="map"/><MapWorkshop initialMode={mode} campaignPreview={params.campaign==="1"} flags={flags}/></main><SiteFooter/></>;
}

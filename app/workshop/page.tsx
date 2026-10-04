import type { Metadata } from "next";
import { WorkshopNav } from "../components/WorkshopNav";
import { SiteHeader, SiteFooter } from "../components/SiteChrome";
import { MapWorkshop } from "../components/MapWorkshop";
import { resolveMode } from "../../lib/game-content";
import "./workshop.css";
import "./campaigns/campaigns.css";

export const metadata:Metadata={title:"Map Workshop | RTS AI",description:"Generate terrain, place every faction's units and buildings, and experiment with browser battles. Save scenes and export maps for OpenRA.",alternates:{canonical:"/workshop"}};
export default async function WorkshopPage({searchParams}:{searchParams:Promise<{mode?:string|string[];campaign?:string}>}){
  const params=await searchParams,mode=resolveMode(params.mode);
  return <><SiteHeader/><main id="main-content" className="workshop-page"><header className="workshop-intro"><div><span className="eyebrow">THE WORKSHOP</span><h1>Build your battlefield.</h1></div><p>Shape the terrain. Place your forces. Play out an idea.<br/>A local experiment space for Red Alert 2 and Classic.</p></header><WorkshopNav mode={mode} active="map"/><MapWorkshop initialMode={mode} campaignPreview={params.campaign==="1"}/></main><SiteFooter/></>;
}

/* The same FactionViewer, served locally without the development RSC transport. */
/* eslint-disable @next/next/no-img-element */
import { createRoot } from "react-dom/client";
import { FactionViewer } from "../components/art/viewer/FactionViewer";
import type { ViewerFaction, ViewerFactionLink } from "../../lib/viewer";
import "../globals.css";
import "../factions/factions.css";

const parts = window.location.pathname.split("/").filter(Boolean);
const factionId = parts[1] || "saudi-arabia", initial = parts[2] || null;
fetch(`/local-viewer-data?faction=${encodeURIComponent(factionId)}`).then(async r => {
  if (!r.ok) throw new Error("Faction not found in the game catalog");
  return r.json() as Promise<{ faction: ViewerFaction; factions: ViewerFactionLink[]; artFactionId: string }>;
}).then(({ faction, factions, artFactionId }) => {
  const marks = Object.fromEntries(factions.map(f => [f.id, f.flag ? <img key={f.id} src={f.flag} width={24} height={18} alt={f.name} /> : <span key={f.id}>{f.name}</span>]));
  createRoot(document.getElementById("local-viewer-root")!).render(<main className="viewer-page"><FactionViewer faction={faction} factions={factions} initial={initial} artFactionId={artFactionId} marks={marks} lineup={null} /></main>);
}).catch(e => { document.getElementById("local-viewer-root")!.textContent = `${e.message}. Existing game files are unchanged.`; });

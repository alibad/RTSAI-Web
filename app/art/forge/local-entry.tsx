// Faction Studio > Concept Forge: mounted only by the local Studio server (scripts/art-lab-preview.ts, /art/forge).
import { createRoot } from "react-dom/client";
import { ConceptForge } from "../../components/forge/ConceptForge";

createRoot(document.getElementById("concept-forge-root")!).render(<ConceptForge />);

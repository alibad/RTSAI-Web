import { redirect } from "next/navigation";
import { viewerFactionIds } from "../../lib/viewer";

/** /viewer opens the first faction. */
export default function ViewerIndex() { redirect(`/viewer/${viewerFactionIds()[0] ?? "china"}`); }

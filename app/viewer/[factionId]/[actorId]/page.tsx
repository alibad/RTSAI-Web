import type { Metadata } from "next";
import { ViewerPage, viewerMetadata } from "../../ViewerPage";

type Props = { params: Promise<{ factionId: string; actorId: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> { const p = await params; return viewerMetadata(p.factionId, p.actorId.toLowerCase()); }
export default async function UnitViewerPage({ params }: Props) { const p = await params; return <ViewerPage factionId={p.factionId} actorId={p.actorId.toLowerCase()} />; }

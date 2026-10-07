import type { Metadata } from "next";
import { ViewerPage, viewerMetadata } from "../ViewerPage";

type Props = { params: Promise<{ factionId: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> { return viewerMetadata((await params).factionId, null); }
export default async function FactionViewerPage({ params }: Props) { return <ViewerPage factionId={(await params).factionId} actorId={null} />; }

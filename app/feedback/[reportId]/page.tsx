import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SiteFooter, SiteHeader } from "../../components/SiteChrome";
import { FeedbackReportViewer } from "../../components/FeedbackReportViewer";
import "../feedback-report.css";

// The files of one feedback report, for the RTS AI team only: linked from the private GitHub issue and the mail alert.
// The page itself is public, but Firestore (firestore.rules) only lets admins read the report, so everyone else sees
// a short notice. Never indexed or listed.
export const metadata: Metadata = {
  title: "Feedback report — RTS AI",
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
};

type Props = { params: Promise<{ reportId: string }> };

export default async function FeedbackReportPage({ params }: Props) {
  const { reportId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(reportId)) notFound();
  return (
    <>
      <SiteHeader />
      <main id="main-content" className="feedback-report-page">
        <FeedbackReportViewer reportId={reportId} />
      </main>
      <SiteFooter />
    </>
  );
}

import { FilePenLine } from "lucide-react";
import { LEGAL } from "../../lib/legal";

/** The draft marker on /terms and /privacy until the owner signs the text off (lib/legal.ts). */
export function LegalDraftNote() {
  if (!LEGAL.draft) return null;
  return (
    <p className="legal-draft" role="note">
      <FilePenLine size={16} aria-hidden="true" />
      <span><strong>Draft for review.</strong> This text is waiting for the RTS AI owner&apos;s review and may change. It is written in plain words and is not legal advice.</span>
    </p>
  );
}

"use client";

import { MessageSquareText } from "lucide-react";
import { useFeedbackStore } from "../../../lib/stores/feedback-store";

/** Opens the site's Feedback panel (sign-in still required) with the current view in the title. */
export function FeedbackButton({ title }: { title: string }) {
  const openWithPrefill = useFeedbackStore(state => state.openWithPrefill);
  return (
    <button type="button" className="art-feedback" onClick={() => openWithPrefill({ title })} title={title}>
      <MessageSquareText size={15} /> Give feedback on this unit
    </button>
  );
}

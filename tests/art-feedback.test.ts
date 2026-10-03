import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { useFeedbackStore } from "../lib/stores/feedback-store";

test("feedback prefill: sets the title, keeps the panel closed, and asks the panel to launch", () => {
  const before = useFeedbackStore.getState().launchRequest;
  useFeedbackStore.getState().openWithPrefill({ title: "[art] china/r2qilin — in-game view, facing 896 (NE), part: turret" });
  const state = useFeedbackStore.getState();
  assert.equal(state.title, "[art] china/r2qilin — in-game view, facing 896 (NE), part: turret");
  assert.equal(state.isOpen, false, "the panel opens itself only after its sign-in check");
  assert.equal(state.launchRequest, before + 1);
  useFeedbackStore.getState().openWithPrefill({ title: "x".repeat(300) });
  assert.equal(useFeedbackStore.getState().title.length, 120, "titles stay within the panel's limit");
});

test("the Feedback panel routes prefill requests through the same sign-in gate as its launcher", () => {
  const panel = readFileSync(new URL("../app/components/FeedbackPanel.tsx", import.meta.url), "utf8");
  const effect = panel.slice(panel.indexOf("const launchRequest"), panel.indexOf("function launch()"));
  assert.match(effect, /launch\(\);/);
  assert.match(panel.slice(panel.indexOf("function launch()")), /if \(!user\) \{\s+awaitingAuth\.current = true;\s+openAuth\(/);
});

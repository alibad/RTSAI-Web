"use client";

import { useEffect } from "react";

/** Same-site paths only, so the link can't bounce a signed-in player to another site. */
export function safeNext(value: string | null) {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") ? value : "/play/";
}

export function ContinueTo() {
  useEffect(() => { location.replace(safeNext(new URLSearchParams(location.search).get("next"))); }, []);
  return <main id="main-content" className="signin-gate"><p className="signin-gate-continue">Signed in. Taking you back…</p></main>;
}

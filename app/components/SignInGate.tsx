"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { Gamepad2, LockKeyhole, Map, Swords } from "lucide-react";
import { useAuth } from "./AuthProvider";
import { firebaseIsConfigured } from "../../lib/firebase-client";
import { onThisMachine } from "../../lib/admin";

// The local admin app (an admin build opened on this machine) is the owner's own: it needs no player account.
// Public builds are never admin builds, so rtsai.net keeps the gate.
const noop = () => () => {};

/**
 * Members-only areas (the game, Workshop, Faction viewer, Earth Studio): a free account unlocks all of them. The gated
 * page's own code and art only load after sign-in. `shell` wraps the signed-out gate (header, card, footer) in one element
 * with these classes, so a page look can style all of it (the public pages pass PathChrome's pathShell).
 */
export function SignInGate({ feature, title, header, footer, shell, children }: { feature: string; title?: string; header: ReactNode; footer: ReactNode; shell?: string; children: ReactNode }) {
  const { user, loading, openAuth } = useAuth();
  const local = useSyncExternalStore(noop, onThisMachine, () => false);
  if (user || !firebaseIsConfigured || local) return <>{children}</>;
  const gate = <>
    {header}
    <main id="main-content" className="signin-gate" aria-busy={loading}>
      {!loading && <section className="signin-gate-card">
        <span className="signin-gate-icon"><LockKeyhole size={22} /></span>
        <span className="eyebrow">FREE ACCOUNT</span>
        <h1>{title ?? `Sign in to open the ${feature}`}</h1>
        <p>One free account unlocks everything.</p>
        <ul>
          <li><Gamepad2 size={16} /> Play in your browser, solo or with friends</li>
          <li><Map size={16} /> Build battlefields in the Workshop and Earth Studio</li>
          <li><Swords size={16} /> Explore every faction’s units</li>
        </ul>
        <button type="button" className="primary-action" onClick={() => openAuth(`Create a free account to open the ${feature}`)}>Create free account</button>
        <button type="button" className="text-action" onClick={() => openAuth(`Sign in to open the ${feature}`)}>I already have an account</button>
      </section>}
    </main>
    {footer}
  </>;
  return shell ? <div className={shell}>{gate}</div> : gate;
}

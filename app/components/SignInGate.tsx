"use client";

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
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
 * `openAccount`: the page exists only to sign in (/signin, where the game sends signed-out players, who have just pressed
 * "Sign in or create account"), so the account dialog opens by itself, once, instead of asking a second time.
 */
export function SignInGate({ feature, title, header, footer, shell, openAccount, children }: { feature: string; title?: string; header: ReactNode; footer: ReactNode; shell?: string; openAccount?: boolean; children: ReactNode }) {
  const { user, loading, openAuth } = useAuth();
  const local = useSyncExternalStore(noop, onThisMachine, () => false);
  const opened = useRef(false);
  useEffect(() => {
    if (!openAccount || opened.current || loading || user || !firebaseIsConfigured || local) return;
    opened.current = true;
    openAuth(`Create a free account to open the ${feature}`);
  }, [openAccount, loading, user, local, openAuth, feature]);
  if (user || !firebaseIsConfigured || local) return <>{children}</>;
  const gate = <>
    {header}
    <main id="main-content" className="signin-gate" aria-busy={loading}>
      {/* Until the account is known (seconds on a phone) the page says so, instead of an empty middle over the footer. */}
      {loading ? <p className="signin-gate-continue" role="status">Checking your account…</p> : <section className="signin-gate-card">
        <span className="signin-gate-icon"><LockKeyhole size={22} /></span>
        <span className="eyebrow">FREE ACCOUNT</span>
        <h1>{title ?? `Sign in to open the ${feature}`}</h1>
        <p>One free account unlocks everything.</p>
        <ul>
          <li><Gamepad2 size={16} /> Play in your browser, solo or with friends</li>
          <li><Map size={16} /> Build battlefields in the map editor and battle simulator</li>
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

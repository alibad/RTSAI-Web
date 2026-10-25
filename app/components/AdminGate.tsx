"use client";

import type { ReactNode } from "react";
import { ExternalLink, LockKeyhole, MonitorSmartphone } from "lucide-react";
import { useAuth } from "./AuthProvider";
import { ADMIN_BUILD, LOCAL_APP, adminSurface, isOwnerEmail, type AdminSurface, type AdminSurfaceId } from "../../lib/admin";
import "./admin.css";

/**
 * Is the owner looking? An admin build (the local app, or dev) is only ever served on the owner's machine, so the build
 * itself is the gate; on rtsai.net it is a sign-in with an owner email (lib/admin.ts).
 */
export function useAdmin() {
  const { user, loading } = useAuth();
  const owner = !!user && isOwnerEmail(user.email, user.emailVerified);
  return { admin: ADMIN_BUILD || owner, loading: !ADMIN_BUILD && loading, signedIn: !!user };
}

/** Its children for the owner; for anyone else, nothing about what is behind it. */
export function AdminOnly({ children }: { children: ReactNode }) {
  const { admin, loading, signedIn } = useAdmin();
  const { openAuth } = useAuth();
  if (loading) return <section className="admin-gate" aria-busy="true" />;
  if (admin) return <>{children}</>;
  return <section className="admin-gate"><div className="admin-gate-card">
    <span className="admin-gate-icon"><LockKeyhole size={20} aria-hidden="true" /></span>
    {signedIn ? <><h1>This page isn&apos;t available</h1><p>It isn&apos;t part of RTS AI for players.</p></>
      : <><h1>Sign in to continue</h1><button type="button" className="primary-action" onClick={() => openAuth("Sign in to continue")}>Sign in</button></>}
  </div></section>;
}

/**
 * An admin surface's page: the tool for the owner, or on rtsai.net a card naming what a local-only tool needs. Public
 * builds carry no code for the local-only tools (vite.config.ts stubs it out), so there they always show the card.
 */
export function AdminGate({ surface, children }: { surface: AdminSurfaceId; children?: ReactNode }) {
  const s = adminSurface(surface);
  return <AdminOnly>{s.needs && !ADMIN_BUILD ? <NeedsThisMachine surface={s} /> : children}</AdminOnly>;
}

/** On rtsai.net: what a local-only tool needs, and the way to it in the local app. */
export function NeedsThisMachine({ surface }: { surface: AdminSurface }) {
  return <section className="admin-gate"><div className="admin-gate-card">
    <span className="admin-gate-icon"><MonitorSmartphone size={20} aria-hidden="true" /></span>
    <span className="eyebrow">ADMIN · RUNS ON YOUR PC</span>
    <h1>{surface.title}</h1>
    <p>{surface.about}</p>
    <div className="admin-needs"><b>Needs: {surface.needs?.what}</b><span>{surface.needs?.detail}</span></div>
    <a className="primary-action" href={`${LOCAL_APP}${surface.href}`}>Open in the local app <ExternalLink size={14} aria-hidden="true" /></a>
    <small>The local app starts with <code>scripts/local-app.ps1</code> in RTSAI-Web, and opens only on that PC.</small>
  </div></section>;
}

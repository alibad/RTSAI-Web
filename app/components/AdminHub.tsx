"use client";

import Link from "next/link";
import { ArrowRight, ExternalLink } from "lucide-react";
import { AdminOnly } from "./AdminGate";
import { ADMIN_BUILD, ADMIN_SURFACES, LOCAL_APP } from "../../lib/admin";

/** Every admin surface and where it works: here, or only on the PC that runs the local app (lib/admin.ts). */
export function AdminHub() {
  return <AdminOnly><main id="main-content" className="admin-hub">
    <header><span className="eyebrow">ADMIN</span><h1>Your tools, and where they run</h1>
      <p>{ADMIN_BUILD ? "This is the local app: every tool works here." : "Tools marked “Works here” open on rtsai.net. The others need services that run on your PC; open them in the local app there."}</p></header>
    <div className="admin-hub-grid">{ADMIN_SURFACES.map((s) => {
      const here = ADMIN_BUILD || !s.needs;
      return <article key={s.id} className="admin-tile">
        <span className={`admin-badge ${here ? "here" : "local"}`}>{here ? "Works here" : "Runs on your PC"}</span>
        <h2>{s.title}</h2>
        <p>{s.about}</p>
        {!here && s.needs && <div className="admin-needs"><b>Needs: {s.needs.what}</b><span>{s.needs.detail}</span></div>}
        {here && !s.studio ? <Link href={s.href}>Open <ArrowRight size={14} aria-hidden="true" /></Link>
          : <a href={`${LOCAL_APP}${s.href}`}>{here ? "Open" : "Open in the local app"} <ExternalLink size={14} aria-hidden="true" /></a>}
      </article>;
    })}</div>
  </main></AdminOnly>;
}

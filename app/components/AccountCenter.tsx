"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { BarChart3, Download, Gamepad2, KeyRound, LockKeyhole, Map, ShieldCheck, Trash2, Users, X } from "lucide-react";
import { EmailAuthProvider, GoogleAuthProvider, reauthenticateWithCredential, reauthenticateWithPopup, signOut, type User } from "firebase/auth";
import { getFirebaseAuth, getFirebaseFirestore } from "../../lib/firebase-client";
import { LEGAL } from "../../lib/legal";
import { useAuth } from "./AuthProvider";
import { chooseAnalytics, useAnalyticsChoice } from "./ConsentBanner";
import { firebaseProfilePhoto } from "./AccountNav";

type Numbers = { matches: number; multiplayer: number; maps: number };

/** The player's own counters and saved-map count, read with their own rights (firestore.rules). */
function useNumbers(user: User) {
  const [numbers, setNumbers] = useState<Numbers | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const [db, F] = await Promise.all([getFirebaseFirestore(), import("firebase/firestore")]);
        if (!db) return;
        const [player, maps] = await Promise.all([
          F.getDoc(F.doc(db, "players", user.uid)),
          F.getCountFromServer(F.query(F.collection(db, "maps"), F.where("owner", "==", user.uid))),
        ]);
        if (live) setNumbers({ matches: Number(player.get("matches") ?? 0), multiplayer: Number(player.get("multiplayer") ?? 0), maps: maps.data().count });
      } catch { /* the tiles are a nice-to-have */ }
    })();
    return () => { live = false; };
  }, [user.uid]);
  return numbers;
}

const method = (user: User) => user.providerData.some((p) => p.providerId === "google.com") ? "google" : "password";

/**
 * Signed-in players only. Its own gate rather than SignInGate, which lets the owner's machine in without an account:
 * here there is nothing to show without one. The goodbye after a deletion (which signs the player out) shows anyway.
 */
export function AccountCenter() {
  const { user, loading, openAuth } = useAuth();
  const [deleted, setDeleted] = useState<{ notified: boolean } | null>(null);
  if (deleted) return <Goodbye notified={deleted.notified} />;
  if (user) return <AccountView user={user} onDeleted={setDeleted} />;
  return (
    <main id="main-content" className="signin-gate" aria-busy={loading}>
      {!loading && <section className="signin-gate-card">
        <span className="signin-gate-icon"><LockKeyhole size={22} /></span>
        <span className="eyebrow">Your account</span>
        <h1>Sign in to see your account</h1>
        <p>Your stats, your data and your privacy choices, in one place.</p>
        <button type="button" className="primary-action" onClick={() => openAuth("Sign in to see your account")}>Sign in</button>
      </section>}
    </main>
  );
}

function AccountView({ user, onDeleted }: { user: User; onDeleted: (result: { notified: boolean }) => void }) {
  const numbers = useNumbers(user);
  const choice = useAnalyticsChoice();
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const name = user.displayName?.trim() || user.email?.split("@")[0] || "Commander";
  const photo = firebaseProfilePhoto(user);
  const since = user.metadata.creationTime ? new Date(user.metadata.creationTime).toLocaleDateString("en-GB", { month: "long", year: "numeric" }) : null;

  async function download() {
    setDownloading(true);
    setDownloadError("");
    try {
      const response = await fetch("/api/account", { headers: { Authorization: `Bearer ${await user.getIdToken()}` } });
      if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error || "Your data could not be gathered. Try again.");
      const url = URL.createObjectURL(await response.blob()), link = document.createElement("a");
      link.href = url;
      link.download = `rtsai-account-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (cause) {
      setDownloadError(cause instanceof Error ? cause.message : "Your data could not be gathered. Try again.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <main id="main-content" className="account-page">
      <section className="account-hero">
        {photo
          // eslint-disable-next-line @next/next/no-img-element
          ? <img className="account-hero-avatar" src={photo} alt="" width={84} height={84} referrerPolicy="no-referrer" />
          : <span className="account-hero-avatar is-fallback" aria-hidden="true">{name.slice(0, 2).toUpperCase()}</span>}
        <div>
          <span className="eyebrow">Your account</span>
          <h1>{name}</h1>
          <p>{user.email}<span aria-hidden="true"> · </span>{method(user) === "google" ? "Google sign-in" : "Email and password"}{since && <><span aria-hidden="true"> · </span>since {since}</>}</p>
        </div>
      </section>

      {numbers && <section className="account-numbers" aria-label="Your numbers">
        <div><Gamepad2 size={18} aria-hidden="true" /><strong>{numbers.matches.toLocaleString("en-US")}</strong><span>matches</span></div>
        <div><Users size={18} aria-hidden="true" /><strong>{numbers.multiplayer.toLocaleString("en-US")}</strong><span>multiplayer</span></div>
        <div><Map size={18} aria-hidden="true" /><strong>{numbers.maps.toLocaleString("en-US")}</strong><span>saved maps</span></div>
      </section>}

      <section className="account-cards">
        <article className="account-card">
          <span className="account-card-icon"><BarChart3 size={20} /></span>
          <h2>Analytics</h2>
          <p>Google Analytics on this device.</p>
          <div className="account-toggle" role="group" aria-label="Google Analytics on this device">
            <button type="button" aria-pressed={choice !== "granted"} onClick={() => chooseAnalytics("denied")}>Off</button>
            <button type="button" aria-pressed={choice === "granted"} onClick={() => chooseAnalytics("granted")}>Allowed</button>
          </div>
        </article>
        <article className="account-card">
          <span className="account-card-icon"><Download size={20} /></span>
          <h2>Your data</h2>
          <p>Everything we keep about you, in one file.</p>
          <button type="button" className="account-button" onClick={() => void download()} disabled={downloading}>{downloading ? "Gathering…" : "Download my data"}</button>
          {downloadError && <p className="account-error" role="alert">{downloadError}</p>}
        </article>
        <article className="account-card is-danger">
          <span className="account-card-icon"><Trash2 size={20} /></span>
          <h2>Delete account</h2>
          <p>Gone for good, with your stats, maps and feedback files.</p>
          <button type="button" className="account-button is-danger" onClick={() => setConfirming(true)}>Delete my account</button>
        </article>
      </section>

      <p className="account-links"><ShieldCheck size={15} aria-hidden="true" /> <Link href="/privacy">What we keep and why</Link> · <Link href="/terms">Terms</Link></p>
      {confirming && <DeleteDialog user={user} numbers={numbers} onClose={() => setConfirming(false)} onDownload={() => { setConfirming(false); void download(); }} onDeleted={onDeleted} />}
    </main>
  );
}

type Step = "confirm" | "reauth" | "deleting";

function DeleteDialog({ user, numbers, onClose, onDownload, onDeleted }: { user: User; numbers: Numbers | null; onClose: () => void; onDownload: () => void; onDeleted: (result: { notified: boolean }) => void }) {
  const [step, setStep] = useState<Step>("confirm");
  const [typed, setTyped] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const google = method(user) === "google";

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && step !== "deleting") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, step]);

  async function erase() {
    setStep("deleting");
    setError("");
    try {
      // The function wants a sign-in from the last ten minutes; ask again a little before that.
      const { authTime } = await user.getIdTokenResult();
      if (Date.now() - Date.parse(authTime) > 9 * 60_000) { setStep("reauth"); return; }
      const response = await fetch("/api/account", { method: "DELETE", headers: { Authorization: `Bearer ${await user.getIdToken(true)}` } });
      const body = await response.json().catch(() => ({})) as { error?: string; reauthenticate?: boolean; notified?: boolean };
      if (response.status === 401 && body.reauthenticate) { setStep("reauth"); return; }
      if (!response.ok) throw new Error(body.error || "Deleting failed. Your account is still there: try again.");
      const auth = getFirebaseAuth();
      if (auth) await signOut(auth).catch(() => undefined);
      onDeleted({ notified: Boolean(body.notified) });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Deleting failed. Try again.");
      setStep("confirm");
    }
  }

  async function reauthenticate(event?: FormEvent) {
    event?.preventDefault();
    setError("");
    try {
      if (google) await reauthenticateWithPopup(user, new GoogleAuthProvider());
      else await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email ?? "", password));
      await erase();
    } catch (cause) {
      const code = typeof cause === "object" && cause && "code" in cause ? String(cause.code) : "";
      setError(code.includes("invalid-credential") || code.includes("wrong-password") ? "That password doesn't match." : code.includes("popup") ? "The Google window closed before it finished." : "That didn't work. Try again.");
    }
  }

  const ready = typed.trim().toUpperCase() === "DELETE";
  return (
    <div className="auth-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && step !== "deleting") onClose(); }}>
      <section className="account-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-title">
        <button type="button" className="account-dialog-close" onClick={onClose} aria-label="Keep my account" disabled={step === "deleting"}><X size={18} /></button>
        <span className="account-dialog-icon"><Trash2 size={22} /></span>
        <h2 id="delete-title">{step === "reauth" ? "Confirm it's you" : "Delete your account?"}</h2>
        {step === "reauth" ? <form onSubmit={(event) => void reauthenticate(event)} className="account-reauth">
          <p>For your safety, sign in once more to delete.</p>
          {google
            ? <button type="button" className="account-button" onClick={() => void reauthenticate()}><KeyRound size={15} /> Continue with Google</button>
            : <><label><span>Password</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
              <button type="submit" className="account-button">Confirm</button></>}
        </form> : <>
          <ul className="account-gone">
            <li><ShieldCheck size={16} /> Your sign-in and profile</li>
            <li><Gamepad2 size={16} /> Your stats{numbers ? ` (${numbers.matches} matches)` : ""}</li>
            <li><Map size={16} /> {numbers ? `${numbers.maps} saved map${numbers.maps === 1 ? "" : "s"}` : "Your saved maps"}</li>
            <li><Download size={16} /> Feedback files and team emails about you</li>
          </ul>
          <p className="account-dialog-note">This can&apos;t be undone. <button type="button" className="account-inline" onClick={onDownload}>Download your data</button> first if you want a copy.</p>
          <label className="account-type"><span>Type DELETE to confirm</span><input value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" spellCheck={false} disabled={step === "deleting"} /></label>
          <div className="account-dialog-actions">
            <button type="button" className="account-button" onClick={onClose} disabled={step === "deleting"}>Keep my account</button>
            <button type="button" className="account-button is-danger" onClick={() => void erase()} disabled={!ready || step === "deleting"}>{step === "deleting" ? "Deleting…" : "Delete forever"}</button>
          </div>
        </>}
        {error && <p className="account-error" role="alert">{error}</p>}
      </section>
    </div>
  );
}

function Goodbye({ notified }: { notified: boolean }) {
  return (
    <main id="main-content" className="account-page">
      <section className="account-goodbye">
        <span className="account-dialog-icon"><Trash2 size={22} /></span>
        <h1>Your account is deleted.</h1>
        <p>{notified
          ? "We've removed your data from our database. The team will clear the last copies outside it (feedback issues, the email archive and analytics) shortly."
          : <>We&apos;ve removed your data from our database. To clear the last copies outside it, write to <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>.</>}</p>
        <Link className="account-button" href="/">Back to RTS AI</Link>
      </section>
    </main>
  );
}

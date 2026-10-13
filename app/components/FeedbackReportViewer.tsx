"use client";

import { Download, FileAudio, FileText, FileVideo, Image as ImageIcon, Lock, LogIn } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { getFirebaseFirestore } from "../../lib/firebase-client";
import { useAuth } from "./AuthProvider";
import { VoicePlayer } from "./feedback/FeedbackMedia";
import { formatBytes } from "./feedback/media";
import { readFeedbackReport, type LoadedFile, type LoadedReport } from "./feedback/report-files";

type ShownFile = LoadedFile & { url: string; text?: string };
type View =
  | { status: "loading" }
  | { status: "denied" }
  | { status: "missing" }
  | { status: "error"; message: string }
  | { status: "ready"; report: Omit<LoadedReport, "files">; files: ShownFile[] };

const textTypes = ["text/plain", "text/markdown", "text/csv", "application/json"];

function FileCaption({ file, label }: { file: ShownFile; label?: string }) {
  return (
    <figcaption>
      <span>{label ? <b>{label}</b> : null}<span title={file.name}>{file.name}</span><small>{file.contentType} · {formatBytes(file.size)}</small></span>
      <a href={file.url} download={file.name} aria-label={`Download ${file.name}`}><Download size={14} /> Download</a>
      {!file.complete && <em>Part of this file did not arrive.</em>}
    </figcaption>
  );
}

function FileTile({ file }: { file: ShownFile }) {
  const icon = file.contentType.startsWith("video/") ? <FileVideo size={16} /> : file.contentType.startsWith("audio/") ? <FileAudio size={16} /> : file.contentType.startsWith("image/") ? <ImageIcon size={16} /> : <FileText size={16} />;
  return (
    <figure className="feedback-report-file">
      <div className="feedback-report-file-head">{icon}</div>
      {file.contentType.startsWith("image/") && <a href={file.url} target="_blank" rel="noreferrer"><img src={file.url} alt={file.name} /></a>}
      {/* Player-submitted recordings: there are no captions to offer. */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      {file.contentType.startsWith("video/") && <video src={file.url} controls preload="metadata" />}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      {file.contentType.startsWith("audio/") && <audio src={file.url} controls preload="metadata" />}
      {file.text !== undefined && <pre>{file.text}</pre>}
      <FileCaption file={file} />
    </figure>
  );
}

/** One report's screenshots, voice note and files, read from Firestore; firestore.rules lets only admins read them. */
export function FeedbackReportViewer({ reportId }: { reportId: string }) {
  const { user, loading, openAuth } = useAuth();
  const [view, setView] = useState<View>({ status: "loading" });

  useEffect(() => {
    if (!user) return;
    let alive = true;
    const urls: string[] = [];
    (async () => {
      try {
        const db = await getFirebaseFirestore();
        if (!db) throw new Error("Firebase is not configured on this site.");
        const report = await readFeedbackReport(db, reportId);
        if (!alive) return;
        if (!report) { setView({ status: "missing" }); return; }
        const files = await Promise.all(report.files.map(async (file) => {
          const url = URL.createObjectURL(file.blob);
          urls.push(url);
          const text = textTypes.includes(file.contentType) ? (await file.blob.text()).slice(0, 20_000) : undefined;
          return { ...file, url, ...(text === undefined ? {} : { text }) };
        }));
        if (alive) setView({ status: "ready", report: { id: report.id, owner: report.owner, source: report.source, created: report.created }, files });
      } catch (cause) {
        if (!alive) return;
        const code = (cause as { code?: string })?.code ?? "";
        if (code === "permission-denied") setView({ status: "denied" });
        else setView({ status: "error", message: cause instanceof Error ? cause.message : "The report could not be read." });
      }
    })();
    return () => {
      alive = false;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [user, reportId]);

  const receipt = `RTS-${reportId.slice(0, 8).toUpperCase()}`;
  const notice = (icon: ReactNode, title: string, body: string, action?: ReactNode) => (
    <section className="feedback-report-notice">
      <span>{icon}</span>
      <p className="eyebrow">Feedback report · {receipt}</p>
      <h1>{title}</h1>
      <p>{body}</p>
      {action}
    </section>
  );

  if (loading) return notice(<Lock size={22} />, "Opening the report…", "Checking your sign-in.");
  if (!user) return notice(<Lock size={22} />, "Only the RTS AI team can open this.", "Sign in with a team account to see this report's screenshots, voice note and files.", <button type="button" onClick={() => openAuth("Sign in to open this feedback report")}><LogIn size={16} /> Sign in</button>);
  if (view.status === "loading") return notice(<Lock size={22} />, "Opening the report…", "Reading its files.");
  if (view.status === "denied") return notice(<Lock size={22} />, "Only the RTS AI team can open this.", `You are signed in as ${user.email || "a player"}, which is not a team account.`);
  if (view.status === "missing") return notice(<FileText size={22} />, "No files in this report.", "It was sent without screenshots, voice notes or files, or it no longer exists.");
  if (view.status === "error") return notice(<FileText size={22} />, "The report could not be read.", view.message);

  const shots = view.files.filter((file) => file.kind === "screenshot");
  const voice = view.files.find((file) => file.kind === "voice");
  const others = view.files.filter((file) => file.kind === "file");
  return (
    <article className="feedback-report">
      <header>
        <p className="eyebrow">Private feedback · team only</p>
        <h1>Report {receipt}</h1>
        <dl>
          <div><dt>Received</dt><dd>{view.report.created ? view.report.created.toLocaleString() : "Unknown"}</dd></div>
          <div><dt>From</dt><dd>{view.report.source === "game" ? "Browser game" : "Website"}</dd></div>
          <div><dt>Reporter</dt><dd><code>{view.report.owner}</code></dd></div>
          <div><dt>Files</dt><dd>{view.files.length} · {formatBytes(view.files.reduce((total, file) => total + file.size, 0))}</dd></div>
        </dl>
      </header>
      {shots.length > 0 && (
        <section aria-label="Screenshots" className="feedback-report-shots">
          {shots.map((file, index) => (
            <figure key={file.id}>
              <a href={file.url} target="_blank" rel="noreferrer" title="Open full size"><img src={file.url} alt={`Screenshot ${index + 1}`} /></a>
              <FileCaption file={file} label={`Screenshot ${index + 1}`} />
            </figure>
          ))}
        </section>
      )}
      {voice && (
        <section aria-label="Voice note" className="feedback-report-voice">
          <VoicePlayer url={voice.url} seconds={voice.durationSeconds ?? 0} />
          <figure><FileCaption file={voice} label="Voice note" /></figure>
        </section>
      )}
      {others.length > 0 && <section aria-label="Files" className="feedback-report-files">{others.map((file) => <FileTile key={file.id} file={file} />)}</section>}
    </article>
  );
}

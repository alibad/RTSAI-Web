import assert from "node:assert/strict";
import test from "node:test";
import {
  chunkCount,
  chunkId,
  chunkRanges,
  createFeedbackReport,
  FEEDBACK_CHUNK_BYTES,
  FEEDBACK_MAX_CHUNKS,
  FEEDBACK_MAX_FILE_BYTES,
  newFileId,
  readFeedbackReport,
  storeFeedbackFile,
} from "../app/components/feedback/report-files";

test("files split into chunks that fit a Firestore document, at most 12 for 10 MB", () => {
  assert.equal(FEEDBACK_CHUNK_BYTES, 921_600);
  assert.ok(FEEDBACK_CHUNK_BYTES + 1024 < 1_048_576, "a chunk plus its name and field stays under the 1 MiB document limit");
  assert.equal(FEEDBACK_MAX_CHUNKS, 12);
  assert.deepEqual([1, FEEDBACK_CHUNK_BYTES, FEEDBACK_CHUNK_BYTES + 1, FEEDBACK_MAX_FILE_BYTES].map(chunkCount), [1, 1, 2, 12]);
  const ranges = chunkRanges(2_000_000);
  assert.deepEqual(ranges.map((r) => [r.start, r.end]), [[0, 921_600], [921_600, 1_843_200], [1_843_200, 2_000_000]]);
  assert.equal(chunkId("abcdefghij012345", 11), "abcdefghij012345_11");
  const ids = new Set(Array.from({ length: 200 }, newFileId));
  assert.equal(ids.size, 200);
  for (const id of ids) assert.match(id, /^[a-z0-9]{16}$/);
});

// Needs: firebase emulators:start --only auth,firestore --project demo-rtsai (RTSAI-Web, loads firestore.rules).
const up = await fetch("http://127.0.0.1:8085/").then(() => true, () => false);

test("a reporter stores files through firestore.rules; only an admin reads them back, byte for byte", { skip: !up && "Firestore emulator not running" }, async () => {
  const { initializeApp, deleteApp } = await import("firebase/app");
  const { getAuth, connectAuthEmulator, createUserWithEmailAndPassword } = await import("firebase/auth");
  const { getFirestore, connectFirestoreEmulator } = await import("firebase/firestore");
  const apps: Parameters<typeof deleteApp>[0][] = [];
  async function signedIn(name: string) {
    const app = initializeApp({ apiKey: "demo-key", projectId: "demo-rtsai", appId: "1:0:web:0" }, `${name}-${Date.now()}`);
    apps.push(app);
    const auth = getAuth(app);
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    const { user } = await createUserWithEmailAndPassword(auth, `${name}${Date.now()}@test.dev`, "test-password-1");
    const db = getFirestore(app);
    connectFirestoreEmulator(db, "127.0.0.1", 8085);
    return { db, uid: user.uid };
  }
  try {
    const reporter = await signedIn("reporter"), admin = await signedIn("admin"), stranger = await signedIn("stranger");
    // Admins are written from the console; the emulator's owner token stands in for it here.
    const promoted = await fetch(`http://127.0.0.1:8085/v1/projects/demo-rtsai/databases/(default)/documents/admins/${admin.uid}`, { method: "PATCH", headers: { Authorization: "Bearer owner", "Content-Type": "application/json" }, body: JSON.stringify({ fields: { note: { stringValue: "test admin" } } }) });
    assert.equal(promoted.status, 200);

    const reportId = crypto.randomUUID();
    await createFeedbackReport(reporter.db, { reportId, owner: reporter.uid, source: "game" });
    const big = new Uint8Array(2_000_000).map((_, i) => (i * 31 + 7) & 255);
    const video = await storeFeedbackFile(reporter.db, { reportId, blob: new Blob([big], { type: "video/webm" }), name: "clip.webm", kind: "file", contentType: "video/webm" });
    const voice = await storeFeedbackFile(reporter.db, { reportId, blob: new Blob([new Uint8Array([26, 69, 223, 163, 1, 2, 3])]), name: "voice-note.webm", kind: "voice", contentType: "audio/webm", durationSeconds: 3.4 });
    assert.equal(video.size, 2_000_000);
    assert.equal(voice.durationSeconds, 3);

    await assert.rejects(createFeedbackReport(reporter.db, { reportId, owner: reporter.uid, source: "game" }), /permission/i, "a report is written once");
    await assert.rejects(createFeedbackReport(stranger.db, { reportId: crypto.randomUUID(), owner: reporter.uid, source: "web" }), /permission/i, "nobody writes a report for someone else");
    await assert.rejects(storeFeedbackFile(stranger.db, { reportId, blob: new Blob(["x"]), name: "x.txt", kind: "file", contentType: "text/plain" }), /permission/i, "nobody adds files to someone else's report");
    await assert.rejects(storeFeedbackFile(reporter.db, { reportId, blob: new Blob(["<b>x</b>"]), name: "x.html", kind: "file", contentType: "text/html" }), /permission/i, "HTML is refused");
    await assert.rejects(readFeedbackReport(reporter.db, reportId), /permission/i, "the reporter can't read the report back");
    await assert.rejects(readFeedbackReport(stranger.db, reportId), /permission/i, "nor can anyone else who isn't an admin");

    const report = await readFeedbackReport(admin.db, reportId);
    assert.ok(report);
    assert.equal(report.owner, reporter.uid);
    assert.equal(report.source, "game");
    assert.deepEqual(report.files.map((f) => [f.kind, f.name, f.size, f.complete]), [["voice", "voice-note.webm", 7, true], ["file", "clip.webm", 2_000_000, true]]);
    assert.deepEqual(new Uint8Array(await report.files[1].blob.arrayBuffer()), big);
    assert.equal(report.files[1].blob.type, "video/webm");
    assert.equal(await readFeedbackReport(admin.db, crypto.randomUUID()), null);
  } finally {
    await Promise.all(apps.map((app) => deleteApp(app)));
  }
});

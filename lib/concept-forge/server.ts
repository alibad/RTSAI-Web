/**
 * The local Studio's Concept Forge API (scripts/art-lab-preview.ts mounts it; local only, never in a public build).
 * It serves the exploratory concepts that RTSAI-Art tools/forge writes to the drafts folder
 * (D:\Generated\RTSAI\art\concept-forge by default, RTSAI_FORGE_DIR to override) and keeps the owner's
 * faction routing and verdicts in that folder's routing.json. Drafts only: nothing here touches the game.
 *
 *   GET  /api/concept-forge/index          palettes, effects, sounds, every concept.json, routing
 *   GET  /api/concept-forge/file/<path>    a sheet, sound or effect from the drafts folder
 *   POST /api/concept-forge/routing        {id, factions?, verdict?, note?} -> routing.json
 */
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

export const forgeRoot = () => resolve(process.env.RTSAI_FORGE_DIR ?? "D:/Generated/RTSAI/art/concept-forge");

const MIME: Record<string, string> = { ".png": "image/png", ".ogg": "audio/ogg", ".json": "application/json", ".wav": "audio/wav" };
const FACTION_IDS = new Set(["iran", "china", "turkey", "saudi-arabia", "yemen", "israel", "hezbollah"]);
const VERDICTS = new Set(["keep", "rework", "drop"]);

export type Routing = Record<string, { factions: string[]; verdict: string | null; note: string; at: string }>;

function readJson<T>(file: string, fallback: T): T {
  try { return JSON.parse(readFileSync(file, "utf8")) as T; } catch { return fallback; }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

export function createConceptForgeMiddleware(root = forgeRoot()) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const path = url.pathname.replace(/^\/api\/concept-forge/, "");
    try {
      if (req.method === "GET" && path === "/index") {
        const index = readJson<{ palettes: unknown; concepts: string[]; fx: unknown; sounds: string[] }>(resolve(root, "index.json"), { palettes: null, concepts: [], fx: {}, sounds: [] });
        const concepts = index.concepts
          .map(id => readJson<Record<string, unknown> | null>(resolve(root, "concepts", id, "concept.json"), null))
          .filter(Boolean);
        send(res, 200, { ...index, concepts, routing: readJson<Routing>(resolve(root, "routing.json"), {}) });
        return;
      }
      if (req.method === "GET" && path.startsWith("/file/")) {
        let rel: string;
        try { rel = decodeURIComponent(path.slice("/file/".length)); } catch { res.writeHead(400).end(); return; }
        const file = resolve(root, rel);
        if (!file.startsWith(root + sep) || !MIME[extname(file)] || !existsSync(file)) { res.writeHead(404).end(); return; }
        res.writeHead(200, { "Content-Type": MIME[extname(file)], "Cache-Control": "no-store" });
        res.end(readFileSync(file));
        return;
      }
      if (req.method === "POST" && path === "/routing") {
        const chunks: Buffer[] = []; let size = 0;
        for await (const c of req) { size += (c as Buffer).length; if (size > 8192) { res.writeHead(413).end(); return; } chunks.push(c as Buffer); }
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as { id?: string; factions?: string[]; verdict?: string | null; note?: string };
        if (!body.id || !/^[a-z0-9-]{2,64}$/.test(body.id) || !existsSync(resolve(root, "concepts", body.id, "concept.json"))) { send(res, 400, { error: "Unknown concept" }); return; }
        const file = resolve(root, "routing.json");
        const routing = readJson<Routing>(file, {});
        const prev = routing[body.id] ?? { factions: [], verdict: null, note: "", at: "" };
        routing[body.id] = {
          factions: Array.isArray(body.factions) ? body.factions.filter(f => FACTION_IDS.has(f)) : prev.factions,
          verdict: body.verdict === null ? null : VERDICTS.has(body.verdict ?? "") ? body.verdict! : prev.verdict,
          note: typeof body.note === "string" ? body.note.slice(0, 2000) : prev.note,
          at: new Date().toISOString(),
        };
        writeFileSync(file + ".tmp", JSON.stringify(routing, null, 1));
        renameSync(file + ".tmp", file);
        send(res, 200, routing);
        return;
      }
      res.writeHead(404).end();
    } catch (error) {
      send(res, 500, { error: String(error) });
    }
  };
}

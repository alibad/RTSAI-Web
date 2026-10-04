#!/usr/bin/env python3
"""Local-only numerical OpenRA arena evaluations. No models, provider calls or asset responses."""
from __future__ import annotations
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import struct
import subprocess
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[1]
GAMES = ROOT.parent
CATALOG = json.loads((ROOT / "data/factions.generated.json").read_text(encoding="utf-8"))["rosters"]
POLICIES = {"nearest", "focus", "hold"}
ORIGINS = {f"http://{host}:{port}" for host in ("127.0.0.1", "localhost") for port in (3000, 3460, 3463)}
JOBS: dict[str, dict] = {}
LOCK = threading.Lock()
PNG = bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082")
RESULT = re.compile(r"EVAL\|(\d+)\|(\d+)\|(\d+)\|(\d+)\|(\d+)\|(\d+)\|(\d+)\r?\n")

def validate(data):
    fields = {"mode", "a", "b", "count", "reps", "duration", "candidate", "baseline", "opponent"}
    if not isinstance(data, dict) or set(data) != fields:
        raise ValueError("Invalid native experiment fields.")
    if data["mode"] not in ("ra", "ra2") or any(data[p] not in POLICIES for p in ("candidate", "baseline", "opponent")):
        raise ValueError("Native policies support advance, focus and hold. Kiting and deployment are browser-only.")
    for key, low, high in (("count", 1, 8), ("reps", 1, 6), ("duration", 10, 120)):
        if type(data[key]) is not int or not low <= data[key] <= high:
            raise ValueError("Native experiment limits exceeded.")
    actors = {a["id"]: a for a in CATALOG["actors"] if a["mode"] == data["mode"]}
    if any(not isinstance(data[k], str) or data[k] not in actors for k in ("a", "b")):
        raise ValueError("Unknown actor in this mode.")
    a, b = (actors[data[k]] for k in ("a", "b"))
    if (a["category"] == "ship") != (b["category"] == "ship") or any(x["behavior"].get("waterPlacement") for x in (a, b)):
        raise ValueError("This native arena supports land/air pairs or ship-versus-ship pairs; naval buildings need a custom map.")
    return dict(data)

def load_harness():
    # Import shared tooling without creating bytecode files in the game checkout.
    sys.dont_write_bytecode = True
    spec = importlib.util.spec_from_file_location("rtsai_balance_harness", GAMES / "RTSAI-Mod/tools/balance-harness.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module

def fixture(target: Path, mode: str, data: dict, policy: str, rep: int):
    target.mkdir(parents=True)
    ra2 = mode == "ra2"
    size = 64
    width, height = (68, 132) if ra2 else (64, 64)
    water = all(next(a for a in CATALOG["actors"] if a["mode"] == mode and a["id"] == data[k])["category"] == "ship" for k in ("a", "b"))
    tile = (314 if water else 0) if ra2 else (1 if water else 255)
    cells = width * height
    terrain = b"".join(struct.pack("<HB", tile, (x * 7 + y * 11) % 16 if not ra2 and not water else 0) for x in range(width) for y in range(height))
    (target / "map.bin").write_bytes(struct.pack("<BHHIII", 2, width, height, 17, 0, 17 + cells * 3) + terrain + b"\0" * (cells * 2))
    (target / "map.png").write_bytes(PNG)
    mod = "rtsai" if ra2 else "ra"
    faction = "america" if ra2 else "england"
    # Map is entirely owned procedural data; no tiles or images are copied from EA content.
    yaml = f"MapFormat: 12\nRequiresMod: {mod}\nTitle: AI behavior arena\nAuthor: RTS AI\nTileset: {'TEMPERATE' if ra2 else 'TEMPERAT'}\nMapSize: {width},{height}\nBounds: 1,1,{width-2},{height-2}\nVisibility: Lobby\nCategories: Conquest\nPlayers:\n"
    for name, extra in (("Neutral", "\t\tOwnsWorld: True\n\t\tNonCombatant: True\n"), ("Multi0", "\t\tPlayable: True\n\t\tLockFaction: True\n\t\tLockSpawn: True\n\t\tSpawn: 1\n"), ("DuelA", "\t\tNonCombatant: True\n\t\tEnemies: DuelB\n\t\tColor: 77C3DE\n"), ("DuelB", "\t\tNonCombatant: True\n\t\tEnemies: DuelA\n\t\tColor: E8997F\n")):
        yaml += f"\tPlayerReference@{name}:\n\t\tName: {name}\n\t\tFaction: {faction}\n" + extra
    yaml += f"Actors:\n\tSpawn: mpspawn\n\t\tOwner: Neutral\n\t\tLocation: {'36,2' if ra2 else '8,8'}\nRules: arena-rules.yaml\n"
    (target / "map.yaml").write_text(yaml, encoding="utf-8")
    (target / "arena-rules.yaml").write_text("World:\n\t-StartGameNotification:\n\tScriptTriggers:\n\tLuaScript:\n\t\tScripts: arena.lua\nPlayer:\n\tShroud:\n\t\tFogCheckboxEnabled: False\n\t\tFogCheckboxLocked: True\n\t\tExploredMapCheckboxEnabled: True\n\t\tExploredMapCheckboxLocked: True\n", encoding="utf-8")
    values = {**data, "policy": policy, "mirror": rep % 2 == 1, "ra2": ra2}
    script = (ROOT / "tools/native-eval.lua").read_text(encoding="utf-8").replace("__CONFIG__", "{ " + ", ".join(f'{k} = {str(v).lower() if isinstance(v, bool) else v if isinstance(v, int) else json.dumps(v)}' for k, v in values.items()) + " }")
    (target / "arena.lua").write_text(script, encoding="utf-8")

def commit(path):
    return subprocess.check_output(["git", "-C", str(path), "rev-parse", "HEAD"], text=True).strip()

def run_job(job, output, content):
    process = None
    try:
        data = job["request"]
        ra2 = data["mode"] == "ra2"
        engine = GAMES / ("RTSAI-Mod/engine" if ra2 else "OpenRA")
        repo = GAMES / ("RTSAI-Mod" if ra2 else "OpenRA")
        if not (engine / "bin/OpenRA.dll").is_file() or not (content / data["mode"]).is_dir():
            raise ValueError("The selected engine or local game content is missing.")
        actual = commit(repo)
        if actual != CATALOG["sources"][data["mode"]]["commit"]:
            raise ValueError("Game rules and website catalog differ. Refresh the catalog before native testing.")
        if subprocess.check_output(["git", "-C", str(repo), "status", "--porcelain", "--", "mods"], text=True).strip():
            raise ValueError("Game mod files have uncommitted changes. Commit or isolate them before native testing.")
        job["ruleCommit"] = actual
        job["engineSha256"] = hashlib.sha256((engine / "bin/OpenRA.dll").read_bytes()).hexdigest()
        bh = load_harness()
        bh.MOD = "rtsai" if ra2 else "ra"
        job_root = output / job["id"]
        mods = bh.prepare_resources(job_root, repo / "mods")
        for policy in dict.fromkeys((data["baseline"], data["candidate"])):
            for rep in range(data["reps"]):
                if job["cancelled"]:
                    return
                support = job_root / f"{policy}-{rep}" / "support"
                support.mkdir(parents=True)
                bh.link_directory(support / "Content", content)
                fixture(support / bh.user_map_dir(mods / bh.MOD) / "ai-behavior-arena", data["mode"], data, policy, rep)
                env = {k: v for k, v in os.environ.items() if not k.startswith(("OPENRA_AI_", "RTSAI_"))}
                env["DOTNET_ROLL_FORWARD"] = "Major"
                command = ["dotnet", str(engine / "bin/OpenRA.dll"), f"Engine.EngineDir={engine}", f"Engine.ModSearchPaths={mods},{engine / 'mods'}", f"Engine.SupportDir={support}", f"Game.Mod={bh.MOD}", "Game.Platform=Null", "Game.FetchNews=false", "Launch.Map=ai-behavior-arena", "Launch.Benchmark=benchmark-"]
                with (support.parent / "engine.log").open("w", encoding="utf-8") as log:
                    with LOCK:
                        if job["cancelled"]: return
                        process = subprocess.Popen(command, cwd=engine / "bin", env=env, stdout=log, stderr=subprocess.STDOUT)
                        job["process"] = process
                    # A recorded arena result is the completion boundary. Some Classic
                    # configurations keep a lobby alive after the spectator objective ends.
                    # Stop our disposable engine after the complete telemetry line is flushed.
                    deadline = time.monotonic() + 90
                    lua = support / "Logs/lua.log"
                    while process.poll() is None and not job["cancelled"]:
                        if lua.is_file() and RESULT.search(lua.read_text(encoding="utf-8", errors="replace")):
                            process.kill()
                            break
                        if time.monotonic() >= deadline: raise subprocess.TimeoutExpired(command, 90)
                        time.sleep(.2)
                    process.wait(timeout=10)
                if job["cancelled"]: return
                lua = support / "Logs/lua.log"
                text = lua.read_text(encoding="utf-8", errors="replace") if lua.is_file() else ""
                result = RESULT.search(text)
                if not result:
                    raise ValueError("The engine produced no completed arena result. Inspect the local engine log.")
                ticks, a_left, b_left, a_alive, b_alive, a_value, b_value = map(int, result.groups())
                job["rows"].append(dict(a=data["a"], b=data["b"], ticks=ticks, a_left=a_left, b_left=b_left, a_alive=a_alive, b_alive=b_alive, a_value=a_value, b_value=b_value, policy=policy, rep=rep))
        job["status"] = "complete"
    except subprocess.TimeoutExpired:
        job["error"] = "Native engine exceeded the 90-second wall-clock limit. Local logs were retained."
        job["status"] = "failed"
    except Exception as exc:
        job["error"] = str(exc) if isinstance(exc, ValueError) else "Native runner failed. Inspect local logs."
        job["status"] = "failed"
    finally:
        if process and process.poll() is None:
            process.kill()
            process.wait(timeout=10)
        job["process"] = None
        if job["cancelled"]: job["status"] = "cancelled"
        target = output / job["id"]
        if target.is_dir(): (target / "result.json").write_text(json.dumps(public(job), indent=2), encoding="utf-8")

def public(job):
    return {k: job[k] for k in ("id", "status", "rows", "mode", "ruleCommit", "engineSha256", "error") if k in job}

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_): pass
    def allowed(self, mutation=False):
        origin = self.headers.get("Origin")
        host = self.headers.get("Host", "")
        return host in ("127.0.0.1:3462", "localhost:3462") and (origin in ORIGINS or (origin is None and not mutation)) and (not mutation or self.headers.get("X-RTSAI-Eval") == "1")
    def respond(self, code, data):
        self.send_response(code)
        if self.headers.get("Origin") in ORIGINS: self.send_header("Access-Control-Allow-Origin", self.headers["Origin"])
        self.send_header("Vary", "Origin")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())
    def do_OPTIONS(self):
        if not self.allowed() or self.headers.get("Origin") not in ORIGINS: return self.respond(403, {"error": "Local preview only."})
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", self.headers["Origin"])
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-RTSAI-Eval")
        self.end_headers()
    def do_GET(self):
        if not self.allowed(): return self.respond(403, {"error": "Local preview only."})
        if self.path == "/status": return self.respond(200, {"ready": True, "modes": ["ra", "ra2"], "policies": sorted(POLICIES)})
        job = JOBS.get(self.path.removeprefix("/jobs/")) if self.path.startswith("/jobs/") else None
        self.respond(200 if job else 404, public(job) if job else {"error": "Unknown job."})
    def do_POST(self):
        if not self.allowed(True): return self.respond(403, {"error": "Local preview only."})
        if self.path != "/jobs": return self.respond(404, {"error": "Unknown endpoint."})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 4096: raise ValueError("Invalid request size.")
            data = validate(json.loads(self.rfile.read(length)))
            with LOCK:
                if any(j["status"] == "running" for j in JOBS.values()): return self.respond(409, {"error": "A native experiment is already running."})
                # Bound in-memory history; numerical artifacts remain on disk.
                if len(JOBS) >= 24: JOBS.pop(next(iter(JOBS)))
                job = dict(id=uuid.uuid4().hex, status="running", rows=[], mode=data["mode"], ruleCommit="", engineSha256="", request=data, cancelled=False, process=None)
                JOBS[job["id"]] = job
                threading.Thread(target=run_job, args=(job, self.server.output, self.server.content), daemon=True).start()
            self.respond(202, public(job))
        except (ValueError, TypeError, KeyError): self.respond(400, {"error": "Invalid actor, policy or experiment settings. Native supports advance, focus and hold only."})
    def do_DELETE(self):
        if not self.allowed(True): return self.respond(403, {"error": "Local preview only."})
        with LOCK:
            job = JOBS.get(self.path.removeprefix("/jobs/")) if self.path.startswith("/jobs/") else None
            if not job: return self.respond(404, {"error": "Unknown job."})
            if job["status"] == "running":
                job["cancelled"] = True
                job["status"] = "cancelled"
                if job["process"] and job["process"].poll() is None: job["process"].kill()
        self.respond(200, public(job))

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--content", type=Path, default=GAMES / "OpenRA/Support/Content")
    parser.add_argument("--output", type=Path, default=ROOT / ".codex-qa/native-evals")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", 3462), Handler)
    server.output, server.content = args.output.resolve(), args.content.resolve()
    print("Local numerical OpenRA evaluation runner: http://127.0.0.1:3462", flush=True)
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally:
        with LOCK:
            for job in JOBS.values():
                job["cancelled"] = True
                if job["process"] and job["process"].poll() is None: job["process"].kill()
        server.server_close()
if __name__ == "__main__": main()

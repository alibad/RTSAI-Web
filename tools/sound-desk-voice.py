"""Sound desk voice worker: says a line again with the engine, voice and processing chain the faction already uses.

The local admin viewer's Sound desk (lib/sound-desk/server.ts) starts this once and sends one JSON job per line on
stdin; each reply is one JSON line on stdout. Nothing here is new synthesis code: it loads OpenRA-AI's own generators.

  {"kind": "eva", "faction": "china", "clip": "009", "text": "Strategic uplink ready.", "out": "<path>/clip.wav"}
      the faction's announcer: Kokoro voicepack + the faction's radio/mastering chain (scripts/generate-faction-eva.py),
      IMA ADPCM 22.05 kHz like every shipped announcer clip
  {"kind": "voice", "filename": "rcn-infantry-select-zh.wav", "text": "...", "engine": "asis" | "chatterbox", "out": ...}
      a unit voice line through the generator that owns it (scripts/generate-<faction>-voices.py via
      generate-rtsai-mod-audio.py): same speaker, language, best-of-N takes with the Whisper check, same radio chain.
      engine "chatterbox" speaks an English line with Chatterbox (cloned from the speaker's Kokoro reference) instead
      of Kokoro.

Reply: the generator's provenance record (engine, model and revision, licence, voice, seed, takes, QA, processing).
The process exits when stdin closes; the desk closes it after a few idle minutes so the GPU is handed back.

    python tools/sound-desk-voice.py --openra-ai ../OpenRA-AI
"""
from __future__ import annotations

import argparse
import contextlib
import dataclasses
import importlib.util
import json
import shutil
import sys
import tempfile
from pathlib import Path


def load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module  # dataclasses resolve their module through sys.modules
    spec.loader.exec_module(module)
    return module


class Worker:
    def __init__(self, openra_ai: Path):
        self.scripts = openra_ai / "scripts"
        sys.path.insert(0, str(self.scripts))
        import voice_engines  # noqa: E402  (OpenRA-AI scripts/voice_engines.py)

        self.engines = voice_engines
        self.ffmpeg = shutil.which("ffmpeg")
        if not self.ffmpeg:
            raise SystemExit("ffmpeg is required")
        self.synth = None
        self._eva = None
        self._owners = None

    def synthesizer(self):
        if self.synth is None:
            self.synth = self.engines.Synthesizer()
        return self.synth

    def eva(self):
        if self._eva is None:
            self._eva = load(self.scripts / "generate-faction-eva.py", "generate_faction_eva")
        return self._eva

    def owners(self):
        """filename -> (generator name, module, line), exactly as generate-rtsai-mod-audio.py finds them."""
        if self._owners is None:
            orchestrator = load(self.scripts / "generate-rtsai-mod-audio.py", "generate_rtsai_mod_audio")
            self._orchestrator = orchestrator
            self._owners = orchestrator.voice_lines()
        return self._owners

    def run_eva(self, job: dict) -> dict:
        eva = self.eva()
        faction, clip, text = job["faction"], job["clip"], job["text"].strip()
        if faction not in eva.FACTIONS:
            raise ValueError(f"No announcer chain for {faction}")
        previous = eva.EVA_TEXT.get(clip)
        eva.EVA_TEXT[clip] = text
        try:
            with tempfile.TemporaryDirectory(prefix="sound-desk-eva-") as tmp:
                record = eva.render(faction, clip, self.synthesizer(), self.ffmpeg, Path(tmp) / "out", Path(tmp))
                out = Path(job["out"])
                out.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(Path(tmp) / "out" / faction / f"{clip}.wav"), out)
        finally:
            if previous is None:
                eva.EVA_TEXT.pop(clip, None)
            else:
                eva.EVA_TEXT[clip] = previous
        record["previous_text"] = previous
        return record

    def run_voice(self, job: dict) -> dict:
        filename, text = job["filename"], job["text"].strip()
        owner = self.owners().get(filename)
        if owner is None:
            raise ValueError(f"No OpenRA-AI generator owns {filename}")
        name, module, line = owner
        if isinstance(line, dict):
            old = line.get("text")
            new = {**line, "text": text, **({"translation": text} if line.get("language", "").startswith("en") else {})}
            if old != text and not line.get("language", "").startswith("en"):
                new["translation"] = ""
        else:
            old = line.text
            changes = {"text": text}
            fields = {f.name for f in dataclasses.fields(line)}
            if "spoken" in fields and text != old:
                changes["spoken"] = ""  # pointed Hebrew is written by hand; a new text is read as written
            if "translation" in fields and text != old:
                changes["translation"] = text if line.language.startswith("en") else ""
            new = dataclasses.replace(line, **changes)
        table = self.engines.LANGUAGE_ENGINE
        saved = dict(table)
        if job.get("engine") == "chatterbox":
            table["en"] = "chatterbox"
        try:
            with tempfile.TemporaryDirectory(prefix="sound-desk-voice-") as tmp:
                (Path(tmp) / "work").mkdir()
                record = self._orchestrator.render_voice(name, module, new, self.synthesizer(), self.ffmpeg, Path(tmp), Path(tmp) / "work")
                out = Path(job["out"])
                out.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(Path(tmp) / filename), out)
        finally:
            table.clear()
            table.update(saved)
        record["previous_text"] = old
        record["generator"] = f"OpenRA-AI scripts/generate-{name}-voices.py (via RTSAI-Web tools/sound-desk-voice.py)"
        return record

    def close(self):
        if self.synth is not None:
            self.synth.close()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--openra-ai", type=Path, required=True)
    args = parser.parse_args()
    reply_to = sys.stdout
    # Generators print progress; keep stdout for replies only.
    sys.stdout = sys.stderr
    worker = Worker(args.openra_ai.resolve())
    try:
        for raw in sys.stdin:
            raw = raw.strip()
            if not raw:
                continue
            try:
                job = json.loads(raw)
                with contextlib.redirect_stdout(sys.stderr):
                    record = worker.run_eva(job) if job.get("kind") == "eva" else worker.run_voice(job)
                reply = {"ok": True, **record}
            except Exception as error:  # one bad line must not stop the worker
                reply = {"error": f"{type(error).__name__}: {error}"}
            reply_to.write(json.dumps(reply, ensure_ascii=False) + "\n")
            reply_to.flush()
    finally:
        worker.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

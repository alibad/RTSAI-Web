"""Export the project's own faction art for the public Factions pages into public/faction-art/.

usage (from the RTSAI-Web root; `npm run sync:faction-art` picks a Python with numpy and Pillow):
    python scripts/export-faction-art.py           # (re)write public/faction-art/ and data/faction-art*.json
    python scripts/export-faction-art.py --check   # verify outputs against the provenance record; nothing written

Everything exported here is made by the project. No EA/RA2 file is ever opened.
  unit renders   RTSAI-Art .cache/cameo/<actor>/renders/cameo.png: the 480x384 Blender render behind the unit's
                 installed build-menu cameo (tools/cameo_render.py). The script checks that its Lanczos reduction is
                 exactly the committed render-x4.png beside that cameo, and falls back to render-x4.png (240x192)
                 when the cache is absent.
  cameos         the installed 60x48 cameos with name bars: art-preview overlay icons/<actor>.png, copied unchanged;
                 units promoted straight into the mod come from RTSAI-Mod main modern-factions/ (icons/, sprites alike).
  sprites        the installed in-game sprites (overlay vehicles/, infantry/, buildings/ SHP + PAL), decoded here and
                 laid out as one animation strip per unit: vehicles, ships and aircraft turn on the spot; infantry
                 run; buildings and defenses build up. Player colour: the mod's lobby red (F21818), remapped as
                 OpenRA's PlayerColorRemap does.
  lineups        one composite per modern faction, built from that faction's unit renders.
  flags          national flags from lipis/flag-icons v7.3.2 (MIT), taken from the Studio's local copy in
                 app/components/art/review/flags.ts.

Outputs are content-hashed (immutable caching). data/faction-art.json is the slim manifest the pages read;
data/faction-art-provenance.json records every output's source files and SHA-256s. Neither is served.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import os
import re
import struct
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

WEB = Path(__file__).resolve().parents[1]
GAMES = WEB.parent
ART = Path(os.environ.get("RTSAI_ART_DIR", GAMES / "RTSAI-Art"))
OVERLAY_REPO = Path(os.environ.get("RTSAI_PREVIEW_MOD_DIR", GAMES / "RTSAI-Mod-wt-art-preview"))
OVERLAY = OVERLAY_REPO / "mods" / "rtsai" / "art-preview"
# Units promoted straight into the mod (not through the preview overlay) are read from its main checkout: the same
# files under modern-factions/, whose sequence and rules files carry an "art-" prefix.
MAIN_REPO = Path(os.environ.get("RTSAI_MOD_DIR", GAMES / "RTSAI-Mod"))
MAIN = MAIN_REPO / "mods" / "rtsai" / "modern-factions"


def installed_root(actor: str) -> tuple[Path, str]:
    """(folder, sequence/rules file prefix) holding the actor's installed art: the preview overlay, else the mod's main."""
    if (OVERLAY / "icons" / f"{actor}.png").exists():
        return OVERLAY, ""
    if (MAIN / "icons" / f"{actor}.png").exists():
        return MAIN, "art-"
    raise SystemExit(f"{actor}: no installed cameo in {OVERLAY / 'icons'} or {MAIN / 'icons'}")
OUT = WEB / "public" / "faction-art"
MANIFEST = WEB / "data" / "faction-art.json"
PROVENANCE = WEB / "data" / "faction-art-provenance.json"
FLAG_SOURCE = WEB / "app" / "components" / "art" / "review" / "flags.ts"
FLAG_LICENSE = WEB / "docs" / "flag-icons-LICENSE.txt"

PLAYER_COLOR = (0xF2, 0x18, 0x18)  # the mod's lobby preset red (rules ColorPickerManager)
REMAP = range(16, 32)               # PlayerColorPalette RemapIndex of every overlay palette
SHADOW_RGBA = (0, 0, 0, 140)        # OpenRA ShadowIndex alpha
RENDER_WIDTHS = (480, 240)
LINEUP_WIDTHS = (1440, 720)
# Factions whose flag is never published (the pages then show the faction's emblem). Empty: every faction shows its
# national flag (docs/faction-art.md).
NO_FLAG: set[str] = set()
# Flags that are not national flags from flag-icons, each with its own source and licence record. Empty since
# 2026-11-13: the seventh modern faction is Lebanon and shows the flag-icons national flag.
ORGANISATION_FLAGS: dict[str, dict[str, str]] = {}

# Hero lineup per faction: back to front. Slots place each unit's trimmed render on the lineup canvas.
LINEUPS = {
    "china": {"air": "r2skyspear", "sea": "r2luyang", "def": "r2bastion", "veh": "r2zbd", "inf": "r2cnrifle", "main": "r2qilin"},
    "iran": {"air": "r2toufan", "sea": "r2peykaap", "def": "r2iraasite", "veh": "r2raad", "inf": "r2basij", "main": "r2karrar"},
    "turkey": {"air": "r2kuzgun", "sea": "r2marmara", "def": "r2hisar", "veh": "r2yildirim", "inf": "r2trrifle", "main": "r2bozkir"},
    "saudi-arabia": {"air": "r2f15sa", "sea": "r2riyadh", "def": "r2sapatriot", "veh": "r2bradley", "inf": "r2sang", "main": "r2m1a2s"},
    "yemen": {"air": "r2samad", "sea": "r2mokha", "def": "r2ycoastal", "veh": "r2ymlr", "inf": "r2ymr", "main": "r2technical"},
    "israel": {"air": "r2ilfalcon", "sea": "r2ilfrigate", "def": "r2ilbattery", "veh": "r2namer", "inf": "r2ilrifle", "main": "r2merkava"},
    "lebanon": {"air": "r2hzdrone", "sea": "r2hzmissileboat", "def": "r2hzaanest", "veh": "r2hzrockets", "inf": "r2hzrifle", "main": "r2hzrecoilless"},
}
LINEUP_SIZE = (1440, 560)
# slot: (centre x, anchor y, anchor ("top" | "bottom"), max width, max height, shade) as fractions of the canvas
SLOTS = {
    "air": (0.70, 0.02, "top", 0.27, 0.40, 0.80),
    "sea": (0.27, 0.62, "bottom", 0.34, 0.40, 0.74),
    "def": (0.92, 0.70, "bottom", 0.22, 0.40, 0.82),
    "veh": (0.76, 0.93, "bottom", 0.30, 0.46, 0.92),
    "inf": (0.13, 1.00, "bottom", 0.24, 0.74, 1.00),
    "main": (0.47, 1.00, "bottom", 0.40, 0.66, 1.00),
}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def rel(path: Path) -> str:
    """A source path by repository (RTSAI-Web/..., RTSAI-Art/...), so the record does not depend on the checkout."""
    p = path.resolve()
    try:
        return "RTSAI-Web/" + p.relative_to(WEB.resolve()).as_posix()
    except ValueError:
        pass
    try:
        return p.relative_to(GAMES.resolve()).as_posix()
    except ValueError:
        return p.as_posix()


def git_head(repo: Path) -> dict:
    def run(*args):
        r = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True)
        return r.stdout.strip() if r.returncode == 0 else None
    return {"commit": run("rev-parse", "HEAD"), "branch": run("rev-parse", "--abbrev-ref", "HEAD")}


class Writer:
    """Collects content-hashed outputs and their provenance."""

    def __init__(self):
        self.files: dict[str, bytes] = {}
        self.records: list[dict] = []

    def add(self, folder: str, stem: str, ext: str, data: bytes, record: dict) -> str:
        name = f"{folder}/{stem}.{sha256(data)[:12]}.{ext}"
        self.files[name] = data
        self.records.append({"path": f"public/faction-art/{name}", "bytes": len(data), "sha256": sha256(data), **record})
        return f"/faction-art/{name}"


def encode(im: Image.Image, fmt: str, lossless: bool = False) -> bytes:
    buf = io.BytesIO()
    if fmt == "webp":
        im.save(buf, "WEBP", lossless=lossless, quality=100 if lossless else 78, method=6 if lossless else 4, exact=lossless, alpha_quality=100 if lossless else 60)
    elif fmt == "avif":
        im.save(buf, "AVIF", quality=62, speed=4)
    else:
        im.save(buf, "PNG", optimize=True)
    return buf.getvalue()


def source(path: Path, role: str) -> dict:
    return {"role": role, "path": rel(path), "sha256": sha256(path.read_bytes())}


# ---------------------------------------------------------------- unit renders


def feather(im: Image.Image, frac: float = 0.07) -> Image.Image:
    """Fade translucent pixels (the ground shadow) towards the frame edge, so a shadow cut by the render frame never
    ends in a hard line. Opaque pixels, the unit itself, are kept."""
    a = np.asarray(im).astype(np.float32)
    h, w = a.shape[:2]
    ramp = lambda n: np.clip(np.minimum(np.arange(n), np.arange(n)[::-1]) / max(1.0, frac * n), 0, 1)  # noqa: E731
    edge = np.outer(ramp(h), ramp(w))
    fade = edge * edge * (3 - 2 * edge)
    a[..., 3] = np.where(a[..., 3] >= 250, a[..., 3], a[..., 3] * fade)
    return Image.fromarray(a.round().astype(np.uint8), "RGBA")


def unit_render(actor: str) -> tuple[Image.Image, list[dict]]:
    cand = ART / "units" / actor / "candidates" / "cameo-v3-render"
    x4 = cand / "render-x4.png"
    cache = ART / ".cache" / "cameo" / actor / "renders" / "cameo.png"
    icon = installed_root(actor)[0] / "icons" / f"{actor}.png"
    if sha256(icon.read_bytes()) != sha256((cand / "cameo.png").read_bytes()):
        raise SystemExit(f"{actor}: the installed cameo is not the render's cameo; refusing to pair them")
    sources = [source(icon, "installed cameo this render belongs to"), source(x4, "committed 240x192 reduction of the render")]
    if cache.exists():
        big = Image.open(cache).convert("RGBA")
        check = np.asarray(big.resize((240, 192), Image.LANCZOS)).astype(int)
        ref = np.asarray(Image.open(x4).convert("RGBA")).astype(int)
        if big.size == (480, 384) and np.abs(check - ref).max() <= 1:
            return feather(big), [source(cache, "480x384 Blender Cycles render (tools/cameo_render.py)"), *sources]
        print(f"  {actor}: cached render does not match render-x4.png; using the 240px render", file=sys.stderr)
    return feather(Image.open(x4).convert("RGBA")), sources


# ---------------------------------------------------------------- SHP / PAL / MiniYaml


def read_shp(path: Path):
    """TS/RA2 SHP as OpenRA's ShpTSLoader reads it. Returns (width, height, frame count, frame(i)): frames decode on
    demand into full-size index arrays (0 = transparent), since a unit's file holds hundreds we never draw."""
    b = path.read_bytes()
    _, W, H, n = struct.unpack_from("<4H", b, 0)
    cache: dict[int, np.ndarray] = {}

    def frame(i: int) -> np.ndarray:
        if i in cache:
            return cache[i]
        f = np.zeros((H, W), np.uint8)
        if 0 <= i < n:
            x, y, w, h, fmt = struct.unpack_from("<4HB", b, 8 + 24 * i)
            off = struct.unpack_from("<I", b, 8 + 24 * i + 20)[0]
            if off and w and h:
                p = off
                if fmt & 2:
                    for r in range(h):
                        ln = struct.unpack_from("<H", b, p)[0] - 2
                        p += 2
                        end, d = p + ln, 0
                        row = f[y + r]
                        while p < end:
                            c = b[p]
                            p += 1
                            if c == 0 and fmt == 3:
                                d += b[p]
                                p += 1
                            else:
                                row[x + d] = c
                                d += 1
                else:
                    f[y:y + h, x:x + w] = np.frombuffer(b, np.uint8, w * h, p).reshape(h, w)
        cache[i] = f
        return f

    return W, H, n, frame


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def linear_to_srgb(c):
    return c * 12.92 if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


def rgb_to_hsv(r, g, b):
    mx, mn = max(r, g, b), min(r, g, b)
    d = mx - mn
    if d == 0:
        return 0.0, 0.0, mx
    if r == mx:
        h = (g - b) / (6 * d)
    elif g == mx:
        h = (b - r) / (6 * d) + 1 / 3
    else:
        h = (r - g) / (6 * d) + 2 / 3
    h -= math.trunc(h)
    return (h + 1 if h < 0 else h), d / mx, mx


def hsv_to_rgb(h, s, v):
    lerp = lambda a, b, t: a + (b - a) * t  # noqa: E731
    cl = lambda x: min(1.0, max(0.0, x))  # noqa: E731
    m1 = lambda x: x - math.trunc(x)  # noqa: E731
    return (v * lerp(1, cl(abs(h * 6 - 3) - 1), s), v * lerp(1, cl(abs(m1(h + 2 / 3) * 6 - 3) - 1), s),
            v * lerp(1, cl(abs(m1(h + 1 / 3) * 6 - 3) - 1), s))


def read_pal(path: Path) -> np.ndarray:
    """Westwood PAL -> 256x4 RGBA (index 0 transparent), with the player colour remapped (lib/art-lab/remap.ts)."""
    raw = np.frombuffer(path.read_bytes()[:768], np.uint8).reshape(256, 3).astype(np.int32)
    if raw.max() < 64:
        raw = ((raw << 2) & 0xFF) | (raw >> 4)
    pal = np.concatenate([raw, np.full((256, 1), 255)], axis=1).astype(np.uint8)
    hue, sat, val = rgb_to_hsv(*(srgb_to_linear(c / 255) for c in PLAYER_COLOR))
    for i in REMAP:
        v = max(srgb_to_linear(pal[i, k] / 255) for k in range(3))
        pal[i, :3] = [round(linear_to_srgb(c) * 255) for c in hsv_to_rgb(hue, sat, v * val)]
    pal[0] = 0
    return pal


def parse_miniyaml(text: str) -> dict:
    """Tab-indented MiniYaml -> nested dicts ({"value": str, "children": {...}}); comments dropped."""
    root: dict = {}
    stack = [(-1, root)]
    for line in text.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        depth = len(line) - len(line.lstrip("\t"))
        key, _, value = line.strip().partition(":")
        while stack[-1][0] >= depth:
            stack.pop()
        node = {"value": value.strip(), "children": {}}
        stack[-1][1][key.strip()] = node
        stack.append((depth, node["children"]))
    return root


def seq_info(block: dict, defaults: dict | None = None) -> dict:
    get = lambda k, d=None: (block["children"].get(k) or (defaults or {}).get(k) or {"value": d})["value"]  # noqa: E731
    length = int(get("Length", "1")) if get("Length", "1") != "*" else 1
    return {"file": get("Filename"), "start": int(get("Start", "0")), "length": length,
            "stride": int(get("Stride", str(length))), "facings": int(get("Facings", "1")),
            "shadow": int(get("ShadowStart", "-1")), "tick": int(get("Tick", "40"))}


def frame_index(seq: dict, facing: int, k: int, shadow=False) -> int:
    base = seq["start"] + facing * seq["stride"] + (k % seq["length"])
    return base + (seq["shadow"] - seq["start"]) if shadow else base


def turret_offset(offset: tuple[int, int, int], facing_index: int, facings: int) -> tuple[int, int]:
    """Turreted.Offset turned by the body facing, as screen pixels (lib/art-lab sprite-compose turretScreenOffset)."""
    if not any(offset):
        return 0, 0
    theta = facing_index * (2 * math.pi / facings)
    ox, oy, oz = offset
    r0 = math.trunc(math.cos(theta) * ox + math.sin(theta) * oy)
    r1 = math.trunc(-math.sin(theta) * ox + math.cos(theta) * oy)
    wx, wy = r1, -r0  # BodyOrientation.LocalToWorld
    return round(60 * wx / 1448), round(30 * (wy - oz) / 1448)


def compose(size, layers) -> np.ndarray:
    """layers: (frame, palette, dx, dy, shadow). Shadows first (one 140-alpha pass), then pixels in order."""
    W, H = size
    out = np.zeros((H, W, 4), np.uint8)
    shadow = np.zeros((H, W), bool)
    for f, pal, dx, dy, is_shadow in layers:
        if not is_shadow:
            continue
        fh, fw = f.shape
        x0, y0 = (W - fw) // 2 + dx, (H - fh) // 2 + dy
        shadow[y0:y0 + fh, x0:x0 + fw] |= f > 0
    out[shadow] = SHADOW_RGBA
    for f, pal, dx, dy, is_shadow in layers:
        if is_shadow:
            continue
        fh, fw = f.shape
        x0, y0 = (W - fw) // 2 + dx, (H - fh) // 2 + dy
        mask = (f > 1) & (pal[f][..., 3] > 0)
        region = out[y0:y0 + fh, x0:x0 + fw]
        region[mask] = pal[f][mask]
    return out


def sequences_for(actor: str):
    """(kind, sequences, palette path, turret offset, source files) from the installed art, or None."""
    root, pre = installed_root(actor)
    veh_shp = root / "vehicles" / f"{actor}.shp"
    inf_shp = root / "infantry" / f"{actor}.shp"
    bld_shp = root / "buildings" / f"{actor}.shp"
    if veh_shp.exists():
        seqs = parse_miniyaml((root / f"{pre}vehicles-sequences.yaml").read_text(encoding="utf8")).get(actor)
        rules = parse_miniyaml((root / f"{pre}vehicles.yaml").read_text(encoding="utf8")).get(actor, {"children": {}})
        palette = rules["children"].get("RenderSprites", {"children": {}})["children"].get("PlayerPalette", {"value": ""})["value"]
        m = re.match(r"r2prerender-(\w+)player", palette)
        pal = root / "vehicles" / f"{m.group(1)}-prerender.pal" if m else None
        off = rules["children"].get("Turreted", {"children": {}})["children"].get("Offset", {"value": "0,0,0"})["value"]
        return "turntable", seqs, pal, tuple(int(v) for v in off.split(",")), [veh_shp, root / f"{pre}vehicles-sequences.yaml", root / f"{pre}vehicles.yaml"]
    if inf_shp.exists():
        seqs = parse_miniyaml((root / f"{pre}infantry-sequences.yaml").read_text(encoding="utf8")).get(actor)
        return "run", seqs, root / "infantry" / f"{actor}.pal", (0, 0, 0), [inf_shp, root / f"{pre}infantry-sequences.yaml"]
    if bld_shp.exists() and root == OVERLAY:
        seqs = parse_miniyaml((OVERLAY / "buildings" / f"{actor}.sequences.part").read_text(encoding="utf8")).get(actor)
        rules = parse_miniyaml((OVERLAY / "buildings" / f"{actor}.rules.part").read_text(encoding="utf8")).get(actor, {"children": {}})
        off = rules["children"].get("Turreted", {"children": {}})["children"].get("Offset", {"value": "0,0,0"})["value"]
        return "build", seqs, OVERLAY / "buildings" / f"{actor}.pal", tuple(int(v) for v in off.split(",")), [bld_shp, OVERLAY / "buildings" / f"{actor}.sequences.part", OVERLAY / "buildings" / f"{actor}.rules.part"]
    return None


def sprite_strip(actor: str):
    """The unit's installed sprite as one horizontal animation strip (frames, frame size, frame time, sources)."""
    found = sequences_for(actor)
    if not found:
        return None
    kind, seqs, pal_path, toff, files = found
    if not seqs or not pal_path or not pal_path.exists():
        return None
    defaults = seqs["children"].get("Defaults", {"children": {}})["children"]
    seq = lambda name: seq_info(seqs["children"][name], defaults) if name in seqs["children"] else None  # noqa: E731
    shp_path = files[0]
    W, H, _, get = read_shp(shp_path)
    pal = read_pal(pal_path)
    pad = 64
    size = (W + 2 * pad, H + 2 * pad)
    out, tick = [], 70

    def body_layers(body, turret, facing, k, turret_facing):
        layers = []
        tdx, tdy = turret_offset(toff, facing, body["facings"]) if turret else (0, 0)
        if body["shadow"] >= 0:
            layers.append((get(frame_index(body, facing, k, True)), pal, 0, 0, True))
        if turret and turret["shadow"] >= 0:
            layers.append((get(frame_index(turret, turret_facing, k, True)), pal, tdx, tdy, True))
        layers.append((get(frame_index(body, facing, k)), pal, 0, 0, False))
        if turret:
            layers.append((get(frame_index(turret, turret_facing, k)), pal, tdx, tdy, False))
        return layers

    if kind == "turntable":
        body, turret = seq("idle"), seq("turret")
        if not body:
            return None
        n = body["facings"]
        for t in range(n):
            f = (n - t) % n  # clockwise as seen from above
            out.append(compose(size, body_layers(body, turret, f, t, f * (turret["facings"] if turret else n) // n)))
    elif kind == "run":
        run = seq("run") or seq("stand")
        facing = 3 * run["facings"] // 8  # south-west: towards the viewer, like the renders
        tick = run["tick"]
        for k in range(run["length"]):
            out.append(compose(size, body_layers(run, None, facing, k, 0)))
    else:
        make, idle, turret = seq("make"), seq("idle"), seq("turret")
        if not make or not idle:
            return None
        tick = max(60, make["tick"])
        for k in range(make["length"]):
            out.append(compose(size, body_layers(make, None, 0, k, 0)))
        tf = (3 * turret["facings"] // 8) if turret else 0
        for _ in range(max(10, make["length"])):
            out.append(compose(size, body_layers(idle, turret, 0, 0, tf)))
    alpha = np.stack([o[..., 3] for o in out]).max(axis=0)
    ys, xs = np.nonzero(alpha)
    if not len(xs):
        return None
    x0, x1, y0, y1 = max(0, xs.min() - 2), xs.max() + 3, max(0, ys.min() - 2), ys.max() + 3
    x1 += (x1 - x0) % 2
    y1 += (y1 - y0) % 2
    crops = [o[y0:y1, x0:x1] for o in out]
    fw, fh = int(x1 - x0), int(y1 - y0)
    strip = np.concatenate(crops, axis=1)
    return Image.fromarray(strip, "RGBA"), fw, fh, len(crops), tick, kind, [*files, pal_path]


# ---------------------------------------------------------------- lineups


def trim(im: Image.Image) -> Image.Image:
    a = np.asarray(im)[..., 3]
    ys, xs = np.nonzero(a > 6)
    return im.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))


def lineup(picks: dict, renders: dict) -> Image.Image:
    W, H = LINEUP_SIZE
    canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    for slot in ("air", "sea", "def", "veh", "inf", "main"):
        actor = picks.get(slot)
        if not actor:
            continue
        cx, ay, anchor, mw, mh, shade = SLOTS[slot]
        im = trim(renders[actor])
        scale = min(mw * W / im.width, mh * H / im.height, 1.12)
        im = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.LANCZOS)
        if shade < 1:
            arr = np.asarray(im).astype(np.float32)
            arr[..., :3] *= shade
            # distance haze: lift the darks a little towards the night backdrop
            arr[..., :3] += (1 - shade) * np.array([28, 32, 30], np.float32)
            im = Image.fromarray(arr.clip(0, 255).astype(np.uint8), "RGBA")
        x = round(cx * W - im.width / 2)
        y = round(ay * H) if anchor == "top" else round(ay * H - im.height)
        canvas.alpha_composite(im, (max(0, min(W - im.width, x)), max(0, y)))
    return canvas


# ---------------------------------------------------------------- flags


def clean_svg(svg: str) -> str:
    """Editor metadata out (XML prolog, comments, Inkscape/Sodipodi data, ids, fixed mm size); drawing unchanged."""
    t = re.sub(r"<\?xml[^>]*\?>\s*", "", svg)
    t = re.sub(r"<!--.*?-->\s*", "", t, flags=re.S)
    t = re.sub(r"<sodipodi:namedview[^>]*/>\s*", "", t, flags=re.S)
    t = re.sub(r"\s+(?:inkscape|sodipodi):[\w-]+=\"[^\"]*\"", "", t)
    t = re.sub(r"\s+xmlns:(?:inkscape|sodipodi|svg)=\"[^\"]*\"", "", t)
    t = re.sub(r"\s+id=\"[^\"]*\"", "", t)
    t = re.sub(r"<svg\s+width=\"[^\"]*\"\s+height=\"[^\"]*\"", "<svg", t)
    t = re.sub(r"<defs\s*/>\s*", "", t)
    t = re.sub(r"\s+", " ", t).replace("> <", "><").strip()
    if not t.startswith("<svg ") or any(ord(c) < 32 for c in t):
        raise SystemExit("flag SVG cleanup produced an invalid document")
    if re.search(r"<script|href=|url\(|<image|<foreignObject", t, re.I):
        raise SystemExit("flag SVG references external content or scripts; refusing to publish it")
    return t


def studio_flags() -> dict[str, tuple[str, str]]:
    """{faction: (svg, kind)} for every flag the site may publish: flag-icons national flags (MIT) and the
    organisation flags the owner approved (ORGANISATION_FLAGS)."""
    line = FLAG_SOURCE.read_text(encoding="utf8").splitlines()[1]
    svgs = json.loads(line[line.index("{"):line.rindex("}") + 1])
    out = {}
    for fid, svg in svgs.items():
        if fid in NO_FLAG:
            continue
        if fid in ORGANISATION_FLAGS:
            out[fid] = (clean_svg(svg), "organisation")
            continue
        if not re.search(r'id="flag-icons-[a-z]{2}"', svg):
            raise SystemExit(f"flag {fid} is neither a flag-icons SVG nor an approved organisation flag; refusing to publish it")
        out[fid] = (re.sub(r'\s+id="flag-icons-[a-z]{2}"', "", svg, count=1), "national")
    return out


# ---------------------------------------------------------------- main


def build() -> tuple[dict[str, bytes], dict, dict]:
    art_lab = json.loads((WEB / "data" / "art-lab.json").read_text(encoding="utf8"))
    w = Writer()
    manifest: dict = {"schemaVersion": 1, "units": {}, "lineups": {}, "flags": {}}
    renders: dict[str, Image.Image] = {}
    for faction in art_lab["factions"]:
        for actor in faction["actors"]:
            print(f"{faction['catalogId']:>13} {actor}")
            render, render_sources = unit_render(actor)
            renders[actor] = render
            entry: dict = {"faction": faction["catalogId"], "category": art_lab["actors"][actor]["category"]}
            ratio = render.height / render.width
            srcs: dict = {"avif": {}, "webp": {}}
            for width in RENDER_WIDTHS:
                if width > render.width:
                    continue
                im = render if width == render.width else render.resize((width, round(width * ratio)), Image.LANCZOS)
                for fmt in ("avif", "webp"):
                    srcs[fmt][str(width)] = w.add("units", f"{actor}-{width}", fmt, encode(im, fmt),
                                                  {"kind": "unit render", "actor": actor, "derivedFrom": render_sources,
                                                   "method": f"shadow faded at the frame edge, resized to {width}px wide, encoded {fmt}"})
            entry["render"] = {"width": render.width, "height": render.height, **srcs}
            icon = installed_root(actor)[0] / "icons" / f"{actor}.png"
            entry["cameo"] = {"src": w.add("cameos", actor, "png", icon.read_bytes(), {"kind": "cameo", "actor": actor, "derivedFrom": [source(icon, "installed cameo")], "method": "copied unchanged"}),
                              "width": 60, "height": 48}
            strip = sprite_strip(actor)
            if strip:
                im, fw, fh, n, tick, kind, files = strip
                entry["sprite"] = {"src": w.add("sprites", actor, "webp", encode(im, "webp", lossless=True),
                                                {"kind": f"sprite strip ({kind})", "actor": actor, "derivedFrom": [source(f, "installed sprite data") for f in files],
                                                 "method": f"{n} frames decoded from the installed SHP with player colour F21818, cropped to {fw}x{fh}, lossless webp"}),
                                   "frameWidth": fw, "frameHeight": fh, "frames": n, "frameMs": tick, "motion": kind}
            manifest["units"][actor] = entry
    for fid, picks in LINEUPS.items():
        im = lineup(picks, renders)
        ratio = im.height / im.width
        srcs = {"avif": {}, "webp": {}}
        for width in LINEUP_WIDTHS:
            scaled = im if width == im.width else im.resize((width, round(width * ratio)), Image.LANCZOS)
            for fmt in ("avif", "webp"):
                srcs[fmt][str(width)] = w.add("lineups", f"{fid}-{width}", fmt, encode(scaled, fmt),
                                              {"kind": "faction lineup", "faction": fid,
                                               "derivedFrom": [d for a in picks.values() for d in [{"role": "unit render", "actor": a}]],
                                               "method": f"composited from the faction's unit renders, {width}px wide, {fmt}"})
        manifest["lineups"][fid] = {"actors": list(picks.values()), "width": im.width, "height": im.height, **srcs}
    licence = FLAG_LICENSE.read_bytes()
    w.files["flags/LICENSE.txt"] = licence
    w.records.append({"path": "public/faction-art/flags/LICENSE.txt", "bytes": len(licence), "sha256": sha256(licence), "kind": "licence",
                      "derivedFrom": [source(FLAG_LICENSE, "flag-icons MIT licence")], "method": "copied unchanged"})
    for fid, (svg, kind) in studio_flags().items():
        data = svg.encode("utf8")
        if kind == "national":
            record = {"kind": "national flag", "faction": fid, "licence": "MIT (lipis/flag-icons v7.3.2, flags/LICENSE.txt)",
                      "derivedFrom": [{"role": "flag-icons v7.3.2 4x3 SVG, as embedded in the Studio", "path": rel(FLAG_SOURCE)}],
                      "method": "root id attribute removed; drawing unchanged"}
            size = (640, 480)
        else:
            org = ORGANISATION_FLAGS[fid]
            record = {"kind": "organisation flag", "faction": fid, "licence": org["licence"],
                      "derivedFrom": [{"role": f"organisation flag, as embedded in the Studio; source {org['source']}", "path": rel(FLAG_SOURCE)}],
                      "method": "editor metadata removed (prolog, comments, Inkscape data, ids, mm size); drawing unchanged"}
            vb = [float(v) for v in re.search(r'viewBox="([^"]+)"', svg).group(1).split()]
            size = (round(480 * vb[2] / vb[3]), 480)
        manifest["flags"][fid] = {"src": w.add("flags", fid, "svg", data, record), "width": size[0], "height": size[1]}
    provenance = {
        "schemaVersion": 1,
        "generatedBy": "scripts/export-faction-art.py",
        "policy": "Only project-made images and MIT national flags (docs/faction-art.md). No EA/RA2 file is opened or exported.",
        "sources": {"RTSAI-Art": git_head(ART), "art-preview overlay": git_head(OVERLAY_REPO), "RTSAI-Mod main": git_head(MAIN_REPO),
                    "flag-icons": {"version": "7.3.2", "licence": "MIT", "url": "https://github.com/lipis/flag-icons/tree/v7.3.2/flags/4x3"}},
        "files": sorted(w.records, key=lambda r: r["path"]),
    }
    return w.files, manifest, provenance


def check() -> int:
    prov = json.loads(PROVENANCE.read_text(encoding="utf8"))
    listed = {r["path"]: r for r in prov["files"]}
    on_disk = {p.relative_to(WEB).as_posix() for p in OUT.rglob("*") if p.is_file()}
    bad = sorted(on_disk - set(listed))
    for path, r in listed.items():
        f = WEB / path
        if not f.exists() or sha256(f.read_bytes()) != r["sha256"]:
            bad.append(path)
    for r in prov["files"]:
        for d in r.get("derivedFrom", []):
            path = d.get("path", "")
            p = (WEB / path[len("RTSAI-Web/"):] if path.startswith("RTSAI-Web/") else GAMES / path) if path else None
            if p and p.exists() and d.get("sha256") and sha256(p.read_bytes()) != d["sha256"]:
                print(f"stale: {r['path']} was made from an older {d['path']}")
    if bad:
        print("faction art out of date:\n  " + "\n  ".join(bad))
        return 1
    print(f"faction art ok: {len(listed)} files")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--check", action="store_true")
    if ap.parse_args().check:
        return check()
    files, manifest, provenance = build()
    keep = set(files)
    if OUT.exists():
        for p in OUT.rglob("*"):
            if p.is_file() and p.relative_to(OUT).as_posix() not in keep:
                p.unlink()
    for name, data in files.items():
        p = OUT / name
        p.parent.mkdir(parents=True, exist_ok=True)
        if not p.exists() or p.read_bytes() != data:
            p.write_bytes(data)
    MANIFEST.write_text(json.dumps(manifest, indent=1, ensure_ascii=False) + "\n", encoding="utf8")
    PROVENANCE.write_text(json.dumps(provenance, indent=1, ensure_ascii=False) + "\n", encoding="utf8")
    total = sum(len(d) for d in files.values())
    print(f"wrote {len(files)} files, {total / 1e6:.1f} MB, to {OUT.relative_to(WEB).as_posix()}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())

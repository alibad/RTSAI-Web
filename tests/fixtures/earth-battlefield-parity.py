"""Parity harness for tests/earth-battlefield.test.ts.

Runs RTSAI-Mod's tools/earth-battlefield.py compile_map() (loaded unmodified via importlib) with the rough-ground
noise switched off, for every case in a JSON file, and writes each map into <out>/<case>/ (write_map's maps.MAPS is
redirected there by compile_map itself). It also decodes PNGs with Pillow so the test can compare raw RGBA:
<out>/<case>/py.rgba from the Python's map.png, and <out>/<case>/ts.rgba from <out>/<case>.ts.png when present.

  python -B earth-battlefield-parity.py <RTSAI-Mod root> <cases.json> <out dir>
"""
import importlib.util
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.dont_write_bytecode = True
mod_root, cases_file, out_root = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
spec = importlib.util.spec_from_file_location("earth_battlefield", mod_root / "tools" / "earth-battlefield.py")
earth = importlib.util.module_from_spec(spec)
spec.loader.exec_module(earth)
# numpy's generator cannot be reproduced in JS: both sides switch the noise off.
earth.maps.smooth_noise = lambda px, py, seed, scale: np.zeros(np.shape(px))


def rgba(path):
    with Image.open(path) as image:
        image.load()
        return image.mode, image.size, image.tobytes()


summary = {}
for case in json.loads(cases_file.read_text(encoding="utf-8")):
    out = out_root / case["name"]
    report = earth.compile_map(case["request"], out)
    mode, size, data = rgba(out / "map.png")
    (out / "py.rgba").write_bytes(data)
    entry = {"pyMode": mode, "pySize": list(size), "validation": report["validation"], "features": report["features"]}
    ts_png = out_root / f"{case['name']}.ts.png"
    if ts_png.exists():
        mode, size, data = rgba(ts_png)
        (out / "ts.rgba").write_bytes(data)
        entry.update(tsMode=mode, tsSize=list(size))
    summary[case["name"]] = entry
(out_root / "summary.json").write_text(json.dumps(summary), encoding="utf-8")

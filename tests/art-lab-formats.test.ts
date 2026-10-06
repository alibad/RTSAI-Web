import assert from "node:assert/strict";
import test from "node:test";
import { decodePal, isSixBitPal } from "../lib/art-lab/pal";
import { checkVxl, decodeVxl, voxelAt } from "../lib/art-lab/vxl";
import { decodeHva, hvaColumnMajor } from "../lib/art-lab/hva";
import { decodeShp, isShpTs } from "../lib/art-lab/shp";
import { hsvToRgb, parseHexColor, remapPalette, rgbToHsv } from "../lib/art-lab/remap";
import { parseFluent } from "../lib/art-lab/fluent";
import { legacyArt as manifest, legacyBytes } from "./legacy-art";

const art = (key: string) => legacyBytes(key);

/** Minimal VXL writer (one limb), following the layout the decoder and OpenRA read. */
function encodeVxl(size: [number, number, number], voxels: Map<string, [number, number]>, normalsMode = 4) {
  const [sx, sy, sz] = size;
  const starts: number[] = [];
  const ends: number[] = [];
  const spans: number[] = [];
  for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
    const column = [...Array(sz).keys()].filter(z => voxels.has(`${x},${y},${z}`));
    if (!column.length) { starts.push(-1); ends.push(-1); continue; }
    starts.push(spans.length);
    let z = 0;
    while (z < sz) {
      const from = z;
      while (z < sz && !voxels.has(`${x},${y},${z}`)) z++;
      const skip = z - from;
      const at = z;
      while (z < sz && voxels.has(`${x},${y},${z}`)) z++;
      const count = z - at;
      spans.push(skip, count);
      for (let h = at; h < z; h++) spans.push(...voxels.get(`${x},${y},${h}`)!);
      spans.push(count);
    }
    ends.push(spans.length - 1);
  }
  const body = Buffer.concat([Buffer.from(new Int32Array(starts).buffer), Buffer.from(new Int32Array(ends).buffer), Buffer.from(spans)]);
  const header = Buffer.alloc(802);
  header.write("Voxel Animation\0", 0, "latin1");
  header.writeUInt32LE(1, 16); header.writeUInt32LE(1, 20); header.writeUInt32LE(1, 24); header.writeUInt32LE(body.length, 28);
  header[32] = 16; header[33] = 31;
  const limb = Buffer.alloc(28);
  limb.write("body", 0, "latin1");
  limb.writeUInt32LE(1, 20);
  const tailer = Buffer.alloc(92);
  tailer.writeUInt32LE(0, 0); tailer.writeUInt32LE(sx * sy * 4, 4); tailer.writeUInt32LE(sx * sy * 8, 8);
  tailer.writeFloatLE(1 / 12, 12);
  [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0].forEach((v, i) => tailer.writeFloatLE(v, 16 + 4 * i));
  [-sx / 2, -sy / 2, 0, sx / 2, sy / 2, sz].forEach((v, i) => tailer.writeFloatLE(v, 64 + 4 * i));
  tailer[88] = sx; tailer[89] = sy; tailer[90] = sz; tailer[91] = normalsMode;
  return new Uint8Array(Buffer.concat([header, limb, body, tailer]));
}

test("PAL: 6-bit components expand to 8-bit as OpenRA does, index 0 transparent", () => {
  const bytes = new Uint8Array(768);
  bytes.set([63, 32, 1], 3);
  const pal = decodePal(bytes);
  assert.deepEqual([...pal.slice(4, 8)], [255, 130, 4, 255]); // (v << 2) | (v >> 4)
  assert.equal(pal[3], 0, "index 0 is transparent");
  const shipped = art("voxels/modern.pal");
  assert.ok(isSixBitPal(shipped), "modern.pal is a valid 6-bit palette");
  assert.equal(decodePal(shipped, [0], [1])[7], 140, "shadow indices get alpha 140");
});

test("VXL: decodes spans exactly, checks headers, and flags inconsistent span copies", () => {
  const voxels = new Map<string, [number, number]>([["0,0,0", [20, 1]], ["0,0,1", [21, 2]], ["0,0,3", [40, 3]], ["1,1,2", [50, 4]]]);
  const vxl = decodeVxl(encodeVxl([2, 2, 4], voxels));
  const limb = vxl.limbs[0];
  assert.equal(vxl.limbCount, 1);
  assert.equal(limb.name, "body");
  assert.deepEqual(limb.size, [2, 2, 4]);
  assert.equal(limb.voxelCount, 4);
  assert.equal(limb.columns, 2);
  assert.equal(limb.normalsMode, 4);
  for (const [key, [color, normal]] of voxels) {
    const [x, y, z] = key.split(",").map(Number);
    const i = voxelAt(limb, x, y, z);
    assert.ok(i >= 0, `voxel ${key} present`);
    assert.equal(limb.colors[i], color);
    assert.equal(limb.normals[i], normal);
  }
  assert.equal(voxelAt(limb, 0, 0, 2), -1, "gap stays empty");
  assert.deepEqual(checkVxl(vxl), []);

  const broken = encodeVxl([2, 2, 4], voxels);
  const end = broken.length - 92; // last byte of the body is the final span's trailing count copy
  broken[end - 1] = 9;
  assert.match(checkVxl(decodeVxl(broken)).join("\n"), /trailing copy/);
});

test("VXL: the shipped Qilin hull matches its header and the manifest", () => {
  const vxl = decodeVxl(art("voxels/r2qilin.vxl"));
  const part = manifest.actors.r2qilin.voxel!.parts[0];
  assert.equal(vxl.limbs.length, part.model.sections.length);
  assert.deepEqual(vxl.limbs[0].size, part.model.sections[0].size);
  assert.equal(vxl.limbs[0].voxelCount, part.model.sections[0].voxels);
  assert.deepEqual(checkVxl(vxl), [], "bounds agree with the declared grid and span tables");
  assert.equal(vxl.limbs[0].normalsMode, 4, "RA2 normals");
  assert.equal(vxl.remapStart, 16);
  assert.equal(vxl.remapEnd, 31);
});

test("HVA: per-section 3x4 matrices per frame; the rotor animates over 8 frames", () => {
  const still = decodeHva(art("voxels/r2qilin.hva"));
  assert.equal(still.frameCount, 1);
  assert.deepEqual(still.sectionNames, ["body"]);
  assert.deepEqual(still.rows[0][0], [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
  const rotor = decodeHva(art("voxels/r2ah64satur.hva"));
  assert.equal(rotor.frameCount, 8);
  rotor.rows.forEach((frame, i) => {
    const a = (i * Math.PI) / 16;
    assert.ok(Math.abs(frame[0][0] - Math.cos(a)) < 1e-6 && Math.abs(frame[0][4] - Math.sin(a)) < 1e-6, `frame ${i} rotates by ${i}/16 pi`);
  });
  const m = hvaColumnMajor([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual(m, [1, 5, 9, 0, 2, 6, 10, 0, 3, 7, 11, 0, 4, 8, 12, 1], "row-major file -> OpenRA column-major");
});

function shpFile(width: number, height: number, frames: { x: number; y: number; w: number; h: number; compression: number; rows: number[][] }[]) {
  const headers = Buffer.alloc(8 + 24 * frames.length);
  headers.writeUInt16LE(0, 0); headers.writeUInt16LE(width, 2); headers.writeUInt16LE(height, 4); headers.writeUInt16LE(frames.length, 6);
  const data: Buffer[] = [];
  let offset = headers.length;
  frames.forEach((f, i) => {
    const h = 8 + 24 * i;
    headers.writeUInt16LE(f.x, h); headers.writeUInt16LE(f.y, h + 2); headers.writeUInt16LE(f.w, h + 4); headers.writeUInt16LE(f.h, h + 6);
    headers[h + 8] = f.compression;
    headers.writeUInt32LE(offset, h + 20);
    const rows = f.rows.map(row => {
      if (f.compression === 3) {
        const out: number[] = [];
        for (let i = 0; i < row.length;) {
          if (row[i] === 0) { let n = 0; while (row[i] === 0 && i < row.length) { n++; i++; } out.push(0, n); } else out.push(row[i++]);
        }
        const b = Buffer.alloc(2 + out.length); b.writeUInt16LE(out.length + 2, 0); Buffer.from(out).copy(b, 2); return b;
      }
      if (f.compression === 2) { const b = Buffer.alloc(2 + row.length); b.writeUInt16LE(row.length + 2, 0); Buffer.from(row).copy(b, 2); return b; }
      return Buffer.from(row);
    });
    const blob = Buffer.concat(rows);
    data.push(blob);
    offset += blob.length;
  });
  return new Uint8Array(Buffer.concat([headers, ...data]));
}

test("SHP (TS/RA2): raw, length-prefixed and RLE-zero rows decode to the same full frame", () => {
  const rows = [[0, 5, 6, 0], [7, 0, 0, 8], [0, 0, 9, 0]];
  for (const compression of [1, 2, 3]) {
    const shp = decodeShp(shpFile(6, 5, [{ x: 1, y: 1, w: 4, h: 3, compression, rows }]));
    assert.equal(shp.width, 6);
    assert.equal(shp.frames[0].compression, compression);
    const px = (x: number, y: number) => shp.frames[0].pixels[y * 6 + x];
    assert.deepEqual([px(2, 1), px(3, 1), px(1, 2), px(4, 2), px(3, 3), px(0, 0)], [5, 6, 7, 8, 9, 0], `compression ${compression}`);
  }
  assert.equal(isShpTs(new Uint8Array([1, 0, 0, 0])), false);
});

test("SHP: the shipped infantry and defence sprites have the documented layouts", () => {
  const rifle = decodeShp(art("china-art/r2cnrifle.shp"));
  assert.deepEqual([rifle.width, rifle.height, rifle.frames.length], [48, 48, 112]);
  const bastion = decodeShp(art("china-art/r2bastion.shp"));
  assert.deepEqual([bastion.width, bastion.height, bastion.frames.length], [96, 96, 41]);
  assert.ok(rifle.frames[0].pixels.some(p => p !== 0), "stand frame has pixels");
});

test("Player colour remap follows OpenRA: only remap indices change, brightness order is kept", () => {
  const [h, s, v] = rgbToHsv(0.2, 0.4, 0.8);
  const back = hsvToRgb(h, s, v);
  [0.2, 0.4, 0.8].forEach((c, i) => assert.ok(Math.abs(back[i] - c) < 1e-6));
  const base = decodePal(art("voxels/modern.pal"));
  const red = remapPalette(base, Array.from({ length: 16 }, (_, i) => 16 + i), parseHexColor("F21818"));
  for (let i = 32; i < 256; i++) assert.deepEqual([...red.slice(4 * i, 4 * i + 4)], [...base.slice(4 * i, 4 * i + 4)]);
  const lum = (i: number) => red[4 * i] + red[4 * i + 1] + red[4 * i + 2];
  for (let i = 16; i < 31; i++) assert.ok(lum(i) >= lum(i + 1), `remap ramp stays ordered at ${i}`);
  assert.ok(red[4 * 16] > red[4 * 16 + 1] * 2, "remapped to red");
});

test("Fluent: names and multi-line descriptions; later files override", () => {
  const messages = parseFluent("a-name = First\nb-desc = One\n    two\n\nc = x\n");
  parseFluent("a-name = Second\n", messages);
  assert.equal(messages.get("a-name"), "Second");
  assert.equal(messages.get("b-desc"), "One\ntwo");
});

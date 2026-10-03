/**
 * Westwood HVA (voxel section transforms), following OpenRA.Mods.Cnc/FileFormats/HvaReader.cs:
 * a 16-byte name, frame count, section count, 16-byte section names, then per frame and section a
 * row-major 3x4 matrix of float32.
 */
export type Hva = {
  name: string;
  frameCount: number;
  sectionCount: number;
  sectionNames: string[];
  /** rows[frame][section] = 12 floats, row-major 3x4 as stored in the file. */
  rows: number[][][];
};

export function decodeHva(input: ArrayBuffer | Uint8Array): Hva {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (offset: number) => {
    let s = "";
    for (let i = 0; i < 16; i++) { const c = bytes[offset + i]; if (c === 0) break; s += String.fromCharCode(c); }
    return s;
  };
  const name = text(0);
  const frameCount = view.getUint32(16, true);
  const sectionCount = view.getUint32(20, true);
  const sectionNames = Array.from({ length: sectionCount }, (_, i) => text(24 + 16 * i));
  const start = 24 + 16 * sectionCount;
  const needed = start + 48 * frameCount * sectionCount;
  if (needed > bytes.length) throw new Error(`HVA truncated: ${bytes.length} bytes, header needs ${needed}`);
  const rows: number[][][] = [];
  for (let f = 0; f < frameCount; f++) {
    const frame: number[][] = [];
    for (let s = 0; s < sectionCount; s++) {
      const at = start + 48 * (f * sectionCount + s);
      frame.push(Array.from({ length: 12 }, (_, k) => view.getFloat32(at + 4 * k, true)));
    }
    rows.push(frame);
  }
  return { name, frameCount, sectionCount, sectionNames, rows };
}

/** OpenRA's column-major 4x4 (index 4*column + row) for a stored row-major 3x4. */
export function hvaColumnMajor(row: number[]): number[] {
  const ids = [0, 4, 8, 12, 1, 5, 9, 13, 2, 6, 10, 14];
  const m = new Array<number>(16).fill(0);
  m[15] = 1;
  for (let k = 0; k < 12; k++) m[ids[k]] = row[k];
  return m;
}

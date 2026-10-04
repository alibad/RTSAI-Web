/** Finalize unindexed MediaRecorder WebM. Duration follows Matroska's
 * Info/Duration float and TimestampScale: https://www.matroska.org/technical/elements.html
 * Indexed files need their offsets rebuilt and are deliberately outside this helper. */
export function webmDuration(data: Uint8Array, seconds: number): Uint8Array {
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('Invalid video duration.');
  function element(offset: number) {
    function vint(at: number, id = false) {
      const first = data[at]; if (!first) throw new Error('Invalid WebM header.');
      let width = 1, marker = 128; while (!(first & marker)) { width++; marker >>= 1; }
      if (width > (id ? 4 : 8) || at + width > data.length) throw new Error('Truncated WebM header.');
      let value = id ? first : first & (marker - 1), unknown = !id && value === marker - 1;
      for (let i = 1; i < width; i++) { value = value * 256 + data[at + i]; unknown = unknown && data[at + i] === 255; }
      if (!unknown && !Number.isSafeInteger(value)) throw new Error('Oversized WebM element.');
      return { width, value, unknown };
    }
    const id = vint(offset, true), size = vint(offset + id.width), body = offset + id.width + size.width;
    const end = size.unknown ? data.length : body + size.value;
    if (end > data.length) throw new Error('Truncated WebM element.');
    return { id: id.value, sizeAt: offset + id.width, sizeWidth: size.width, body, end, unknown: size.unknown };
  }
  const header = element(0), segment = element(header.end);
  if (header.id !== 0x1a45dfa3 || segment.id !== 0x18538067 || !segment.unknown) throw new Error('Unsupported WebM recording layout.');
  const info = element(segment.body);
  if (info.id !== 0x1549a966 || info.unknown) throw new Error('Unsupported WebM recording metadata.');
  let scale = 1_000_000, durationOffset = -1;
  for (let at = info.body; at < info.end;) {
    const child = element(at); if (child.unknown || child.end > info.end) throw new Error('Invalid WebM metadata.');
    if (child.id === 0x2ad7b1) { scale = 0; for (let i = child.body; i < child.end; i++) scale = scale * 256 + data[i]; }
    if (child.id === 0x4489) { if (child.end - child.body !== 8) throw new Error('Unsupported WebM duration field.'); durationOffset = child.body; }
    at = child.end;
  }
  if (!Number.isSafeInteger(scale) || scale <= 0) throw new Error('Invalid WebM timestamp scale.');
  // MediaRecorder emits Tracks followed by unknown-size Clusters, without indexes.
  for (let at = info.end; at < data.length;) { const child = element(at); if ([0x114d9b74, 0x1c53bb6b].includes(child.id)) throw new Error('Indexed WebM requires remuxing.'); if (child.unknown) break; at = child.end; }
  if (durationOffset >= 0) { const copy = data.slice(); new DataView(copy.buffer).setFloat64(durationOffset, seconds * 1e9 / scale); return copy; }
  const extra = new Uint8Array(11); extra.set([0x44, 0x89, 0x88]); new DataView(extra.buffer).setFloat64(3, seconds * 1e9 / scale);
  const size = info.end - info.body + extra.length;
  if (size >= 2 ** (7 * info.sizeWidth) - 1) throw new Error('WebM metadata is too large.');
  const output = new Uint8Array(data.length + extra.length); output.set(data.subarray(0, info.end)); output.set(extra, info.end); output.set(data.subarray(info.end), info.end + extra.length);
  let remainder = size; for (let i = info.sizeWidth - 1; i >= 0; i--) { output[info.sizeAt + i] = remainder % 256; remainder = Math.floor(remainder / 256); } output[info.sizeAt] |= 2 ** (8 - info.sizeWidth);
  return output;
}

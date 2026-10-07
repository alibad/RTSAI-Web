/**
 * WAV for the browser. The game's audio (the mod's own clips and RA2's audio.bag) is mostly IMA ADPCM (format 17),
 * which Web Audio's decodeAudioData does not read; this converts it to 16-bit PCM, unchanged otherwise.
 */
export type WavInfo = { format: number; channels: number; sampleRate: number; bitsPerSample: number; blockAlign: number; dataOffset: number; dataLength: number; frames: number; seconds: number };

const STEPS = [7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767];
const INDEX = [-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8];

/** Parses the RIFF header; throws on anything that is not a WAV with fmt and data chunks. */
export function wavInfo(bytes: Uint8Array): WavInfo {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
  if (bytes.length < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("not a RIFF/WAVE file");
  let at = 12, fmt: Omit<WavInfo, "dataOffset" | "dataLength" | "frames" | "seconds"> | null = null;
  let samplesPerBlock = 0;
  while (at + 8 <= bytes.length) {
    const id = tag(at), size = view.getUint32(at + 4, true), body = at + 8;
    if (id === "fmt ") {
      fmt = { format: view.getUint16(body, true), channels: view.getUint16(body + 2, true), sampleRate: view.getUint32(body + 4, true), blockAlign: view.getUint16(body + 12, true), bitsPerSample: view.getUint16(body + 14, true) };
      if (fmt.format === 17 && size >= 20) samplesPerBlock = view.getUint16(body + 18, true);
    } else if (id === "data") {
      if (!fmt) throw new Error("data before fmt");
      const dataLength = Math.min(size, bytes.length - body);
      const frames = fmt.format === 17
        ? Math.floor(dataLength / fmt.blockAlign) * (samplesPerBlock || ((fmt.blockAlign - 4 * fmt.channels) * 8) / (4 * fmt.channels) + 1)
        : Math.floor(dataLength / Math.max(1, fmt.blockAlign));
      return { ...fmt, dataOffset: body, dataLength, frames, seconds: frames / Math.max(1, fmt.sampleRate) };
    }
    at = body + size + (size & 1);
  }
  throw new Error("no data chunk");
}

/** 16-bit PCM WAV for `bytes`: PCM passes through, IMA ADPCM (17) is decoded; other formats throw. */
export function toPcmWav(bytes: Uint8Array): Uint8Array {
  const info = wavInfo(bytes);
  if (info.format === 1 || info.format === 3) return bytes;
  if (info.format !== 17 || info.bitsPerSample !== 4) throw new Error(`unsupported WAV format ${info.format}/${info.bitsPerSample}-bit`);
  const { channels, blockAlign } = info;
  const data = bytes.subarray(info.dataOffset, info.dataOffset + info.dataLength);
  const blocks = Math.floor(data.length / blockAlign);
  // Each block: a 4-byte header per channel (first sample, step index), then 4-byte groups per channel in turn.
  const perBlock = ((blockAlign - 4 * channels) * 8) / (4 * channels) + 1;
  return pcmWav(decodeImaSamples(data, blocks, blockAlign, channels, perBlock), channels, info.sampleRate);
}

function decodeImaSamples(data: Uint8Array, blocks: number, blockAlign: number, channels: number, perBlock: number): Int16Array {
  const out = new Int16Array(blocks * perBlock * channels);
  for (let b = 0; b < blocks; b++) {
    const block = data.subarray(b * blockAlign, (b + 1) * blockAlign);
    const base = b * perBlock * channels;
    for (let c = 0; c < channels; c++) {
      let pred = block[4 * c] | (block[4 * c + 1] << 8); if (pred & 0x8000) pred -= 0x10000;
      let index = Math.min(88, block[4 * c + 2]);
      out[base + c] = pred;
      let n = 1;
      for (let group = 4 * channels + 4 * c; group < block.length; group += 4 * channels) {
        for (let i = 0; i < 4 && group + i < block.length; i++) {
          const byte = block[group + i];
          for (const nibble of [byte & 15, byte >> 4]) {
            if (n >= perBlock) break;
            const step = STEPS[index];
            let diff = step >> 3;
            if (nibble & 4) diff += step;
            if (nibble & 2) diff += step >> 1;
            if (nibble & 1) diff += step >> 2;
            pred = Math.max(-32768, Math.min(32767, nibble & 8 ? pred - diff : pred + diff));
            index = Math.max(0, Math.min(88, index + INDEX[nibble]));
            out[base + n * channels + c] = pred;
            n++;
          }
        }
      }
    }
  }
  return out;
}

/** A canonical 44-byte-header 16-bit PCM WAV. */
export function pcmWav(samples: Int16Array, channels: number, sampleRate: number): Uint8Array {
  const out = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(out.buffer);
  const put = (at: number, s: string) => { for (let i = 0; i < 4; i++) out[at + i] = s.charCodeAt(i); };
  put(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true); put(8, "WAVE");
  put(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * channels * 2, true); view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true);
  put(36, "data"); view.setUint32(40, samples.length * 2, true);
  new Int16Array(out.buffer, 44).set(samples);
  return out;
}

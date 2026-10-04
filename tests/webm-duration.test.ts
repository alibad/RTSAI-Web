import assert from 'node:assert/strict';
import test from 'node:test';
import { webmDuration } from '../lib/webm-duration';

const prefix = [0x1a, 0x45, 0xdf, 0xa3, 0x80, 0x18, 0x53, 0x80, 0x67, 0x01, 255, 255, 255, 255, 255, 255, 255];
function recording(scale = [0x0f, 0x42, 0x40], tail = [0x1f, 0x43, 0xb6, 0x75, 0xff, 0xe7, 0x81, 0]) { const info = [0x2a, 0xd7, 0xb1, 0x80 | scale.length, ...scale]; return new Uint8Array([...prefix, 0x15, 0x49, 0xa9, 0x66, 0x80 | info.length, ...info, ...tail]); }
function readDuration(bytes: Uint8Array) { const at = bytes.findIndex((b, i) => b === 0x44 && bytes[i + 1] === 0x89); return new DataView(bytes.buffer).getFloat64(at + 3); }
test('recordings receive a finite duration while preserving timestamps and frame bytes', () => {
  const original = recording(), fixed = webmDuration(original, 20);
  assert.equal(readDuration(fixed), 20_000); assert.equal(fixed.length, original.length + 11);
  assert.deepEqual(fixed.slice(-8), original.slice(-8)); assert.equal(original[21], 0x87); assert.equal(fixed[21], 0x92);
  const revised = webmDuration(fixed, 30); assert.equal(readDuration(revised), 30_000); assert.equal(revised.length, fixed.length);
});
test('duration uses the recording timestamp scale instead of assuming milliseconds', () => {
  assert.equal(readDuration(webmDuration(recording([0x1e, 0x84, 0x80]), 20)), 10_000);
});
test('truncated, indexed and unsupported files fail instead of producing corrupt metadata', () => {
  assert.throws(() => webmDuration(recording().slice(0, 20), 20), /Truncated/);
  assert.throws(() => webmDuration(recording(), NaN), /Invalid video/);
  assert.throws(() => webmDuration(recording([0]), 20), /timestamp scale/);
  assert.throws(() => webmDuration(recording(undefined, [0x11, 0x4d, 0x9b, 0x74, 0x80]), 20), /Indexed/);
  const finite = recording(); finite[9] = 0x80; assert.throws(() => webmDuration(finite, 20), /Unsupported/);
});

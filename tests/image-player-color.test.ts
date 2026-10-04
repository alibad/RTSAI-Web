import assert from "node:assert/strict";
import test from "node:test";
import { isPlayerColorMarker, remapImagePixels, validImagePlayerColor } from "../lib/art-lab/image-remap";
import { houseColors, parseHexColor, remapPalette } from "../lib/art-lab/remap";

test("player-color image conversion agrees with native palette math for every lobby color and shade", () => {
  const rgba = new Uint8ClampedArray(256 * 4);
  for (let v = 0; v < 256; v++) rgba.set([v, 0, 0, 255], v * 4);
  for (const color of houseColors) {
    const indexed = remapPalette(rgba, Array.from({ length: 256 }, (_, i) => i), parseHexColor(color.hex));
    const image = remapImagePixels(rgba, new Uint8ClampedArray(256).fill(255), color.hex);
    assert.deepEqual(image, indexed);
  }
});

test("explicit ownership mask leaves pale finish, faction jade, cyan optics and transparency byte-identical", () => {
  const rgba = new Uint8ClampedArray([235,230,218,255, 72,92,77,255, 29,180,195,255, 175,25,20,255, 80,12,8,0]);
  for (const color of houseColors) {
    const output = remapImagePixels(rgba, new Uint8ClampedArray([0,0,0,255,255]), color.hex);
    assert.deepEqual(output.slice(0,12), rgba.slice(0,12));
    assert.deepEqual(output.slice(16), rgba.slice(16));
    assert.equal(output[15],255);
  }
  assert.equal(isPlayerColorMarker(235,230,218),false);
  assert.equal(isPlayerColorMarker(29,180,195),false);
  assert.equal(isPlayerColorMarker(175,25,20),true);
  assert.deepEqual(rgba.slice(12,16),new Uint8ClampedArray([175,25,20,255]));
});

test("invalid masks and dimensions fail rather than tint an arbitrary image", () => {
  assert.equal(validImagePlayerColor(undefined),false);
  assert.equal(validImagePlayerColor({image:"master.png",width:480,height:384,marker:"explicit",regions:[[[0,0],[481,0],[10,10]]]}),false);
  assert.throws(() => remapImagePixels(new Uint8ClampedArray(8),new Uint8ClampedArray(1),"F21818"));
});

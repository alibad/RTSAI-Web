import assert from "node:assert/strict";
import test from "node:test";
import { closedPage } from "../lib/content-play-entry";

test("a closed local game says why and offers the released game with the same link", () => {
  const html = closedPage('?mode=sandbox&s=abc"<x');
  assert.match(html, /The local game needs a new build/);
  assert.ok(html.includes('href="https://rtsai.net/play/?mode=sandbox&amp;s=abc%22%3Cx"'), "the simulator setup travels, safely quoted");
  assert.ok(html.includes('href="/art/review"'), "and there is a way back to the Studio");
});

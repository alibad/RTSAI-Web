import assert from "node:assert/strict";
import test from "node:test";
import { ADMIN_SURFACES, isOwnerEmail } from "../lib/admin";

test("only a verified owner email opens the admin on rtsai.net", () => {
  assert.equal(isOwnerEmail("alibadereddin@gmail.com", true), true);
  assert.equal(isOwnerEmail("  AliBadereddin@Gmail.com ", true), true, "case and spaces do not matter");
  assert.equal(isOwnerEmail("alibadereddin@gmail.com", false), false, "an unverified email is not enough");
  assert.equal(isOwnerEmail("someone@gmail.com", true), false);
  assert.equal(isOwnerEmail("alibadereddin@gmail.com.evil.test", true), false);
  assert.equal(isOwnerEmail(null, true), false);
});

test("every admin surface says whether it needs the owner's machine, and what", () => {
  for (const s of ADMIN_SURFACES) {
    assert.ok(s.href.startsWith("/"), s.id);
    if (s.needs) assert.ok(s.needs.what && s.needs.detail, `${s.id} names what it needs`);
  }
  assert.equal(ADMIN_SURFACES.find((s) => s.id === "campaigns")?.needs, null, "Campaign studio works on rtsai.net");
  assert.ok(ADMIN_SURFACES.find((s) => s.id === "arena")?.needs, "the AI Arena needs its local runner");
});

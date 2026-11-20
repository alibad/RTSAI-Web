import assert from "node:assert/strict";
import test from "node:test";
import { browserServers, relayServers, RELAY_TTL_S } from "./relay.js";

// The answer Cloudflare documents for generate-ice-servers.
const cloudflare = {
  iceServers: [
    { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"] },
    {
      urls: [
        "turn:turn.cloudflare.com:3478?transport=udp", "turn:turn.cloudflare.com:53?transport=udp",
        "turn:turn.cloudflare.com:3478?transport=tcp", "turn:turn.cloudflare.com:80?transport=tcp",
        "turns:turn.cloudflare.com:5349?transport=tcp", "turns:turn.cloudflare.com:443?transport=tcp",
      ],
      username: "user", credential: "secret",
    },
  ],
};

test("keeps what a browser can use and drops port 53", () => {
  const servers = browserServers(cloudflare.iceServers);
  assert.deepEqual(servers[0], { urls: ["stun:stun.cloudflare.com:3478"] });
  assert.equal(servers[1].username, "user");
  assert.equal(servers[1].credential, "secret");
  assert.equal(servers[1].urls.length, 5);
  assert.ok(servers[1].urls.every((url) => !/:53(\?|$)/.test(url)));
  assert.ok(servers[1].urls.includes("turns:turn.cloudflare.com:5349?transport=tcp"));
});

test("a TURN address without credentials is dropped, and an answer without a relay is an error", () => {
  assert.throws(() => browserServers([{ urls: ["stun:stun.cloudflare.com:3478", "turn:turn.cloudflare.com:3478"] }]), /No relay/);
  assert.throws(() => browserServers(undefined), /No ICE servers/);
  assert.throws(() => browserServers([{ urls: ["http://example.com"], username: "u", credential: "c" }]), /No relay/);
});

test("asks Cloudflare with the key's secret and the credentials' lifetime", async () => {
  let asked;
  const fetch = async (url, init) => { asked = { url, init }; return new Response(JSON.stringify(cloudflare), { status: 201 }); };
  const result = await relayServers({ keyId: "key/id", token: "s3cret", fetch });
  assert.equal(asked.url, "https://rtc.live.cloudflare.com/v1/turn/keys/key%2Fid/credentials/generate-ice-servers");
  assert.equal(asked.init.method, "POST");
  assert.equal(asked.init.headers.Authorization, "Bearer s3cret");
  assert.deepEqual(JSON.parse(asked.init.body), { ttl: RELAY_TTL_S });
  assert.equal(result.ttl, RELAY_TTL_S);
  assert.equal(result.iceServers.length, 2);
});

test("a refusal or a missing key is an error, never an empty list", async () => {
  const refused = async () => new Response("{}", { status: 401 });
  await assert.rejects(relayServers({ keyId: "k", token: "t", fetch: refused }), /Cloudflare answered 401/);
  await assert.rejects(relayServers({ keyId: "", token: "t", fetch: refused }), /not configured/);
  await assert.rejects(relayServers({ keyId: "k", token: "", fetch: refused }), /not configured/);
});

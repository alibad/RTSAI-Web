// Relay credentials for the web game's direct multiplayer (RTSAI-WebGame web/src/net/relay.ts). Players connect their
// browsers directly; when two networks cannot reach each other (strict or carrier-grade NAT on both sides), the match
// goes through Cloudflare's TURN relay (Realtime TURN: 1,000 GB a month free, then $0.05 per GB; a two-player match
// carries about 37 MB an hour). The relay key's secret stays on the server: a signed-in player gets short-lived
// credentials from the relay function (index.js), and only game data goes through the relay.
// https://developers.cloudflare.com/realtime/turn/generate-credentials/

/** Credentials last four hours: a lobby and a long match fit, and a leaked one stops working the same evening. */
export const RELAY_TTL_S = 4 * 60 * 60;
export const TURN_API = "https://rtc.live.cloudflare.com/v1/turn/keys";

/**
 * Cloudflare's ICE servers, kept to what a browser can use: STUN and TURN addresses only, never port 53 (browsers
 * block it, so it only times out), and a TURN address only with its username and credential.
 */
export function browserServers(list) {
  if (!Array.isArray(list)) throw Error("No ICE servers in the answer");
  const servers = [];
  for (const server of list) {
    const urls = (Array.isArray(server?.urls) ? server.urls : [server?.urls])
      .filter((url) => typeof url === "string" && /^(stun|turns?):[^\s]+$/.test(url) && !/:53(\?|$)/.test(url));
    if (!urls.length) continue;
    if (typeof server.username === "string" && typeof server.credential === "string") {
      servers.push({ urls, username: server.username, credential: server.credential });
    } else {
      const stun = urls.filter((url) => url.startsWith("stun:"));
      if (stun.length) servers.push({ urls: stun });
    }
  }
  if (!servers.some((server) => server.credential)) throw Error("No relay in the answer");
  return servers;
}

/** Fresh credentials for one player from Cloudflare, with the key's secret. */
export async function relayServers({ keyId, token, ttl = RELAY_TTL_S, fetch: get = fetch, api = TURN_API }) {
  if (!keyId || !token) throw Error("The relay key is not configured");
  const response = await get(`${api}/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ttl }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw Error(`Cloudflare answered ${response.status}`);
  return { iceServers: browserServers((await response.json())?.iceServers), ttl };
}

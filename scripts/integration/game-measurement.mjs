export function normalizeWorldStart(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = Object.keys(value).sort();
  if (JSON.stringify(keys) !== JSON.stringify(["event", "mode", "transport", "version"])) return null;
  if (value.version !== 1 || value.event !== "world-started") return null;
  if (!["classic", "isometric"].includes(value.mode) || !["singleplayer", "direct", "room"].includes(value.transport)) return null;
  return { version: 1, mode: value.mode, transport: value.transport };
}
export function installGameMeasurement(target, sink) {
  if (!target || typeof target.addEventListener !== "function" || typeof sink !== "function") throw new TypeError("A game-document event target and explicit event sink are required");
  const receive = event => {
    const payload = normalizeWorldStart(event.detail);
    if (!payload) return;
    sink("game_world_started", payload);
    if (payload.transport !== "singleplayer") sink("game_peer_started", payload);
  };
  target.addEventListener("rtsai:world-started", receive);
  return () => target.removeEventListener("rtsai:world-started", receive);
}

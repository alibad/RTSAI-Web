/**
 * Minimal Fluent reader for the mod's message files: `key = value` with indented continuation lines.
 * Later files override earlier ones, as OpenRA's AddResourceOverriding does. Attributes, terms and
 * selectors are not used by the faction name and description messages; such entries are kept verbatim.
 */
export function parseFluent(text: string, into: Map<string, string> = new Map()) {
  let key: string | null = null;
  let lines: string[] = [];
  const flush = () => {
    if (key) into.set(key, lines.join("\n").trim());
    key = null;
    lines = [];
  };
  for (const raw of text.split(/\r\n|\n/)) {
    if (/^\s*#/.test(raw)) { if (!/^\s/.test(raw)) flush(); continue; }
    const message = /^([A-Za-z][\w-]*)\s*=\s*(.*)$/.exec(raw);
    if (message) { flush(); key = message[1]; lines = [message[2]]; continue; }
    if (key && /^\s+\S/.test(raw)) { lines.push(raw.trim()); continue; }
    if (!raw.trim()) { if (key) lines.push(""); continue; }
    flush();
  }
  flush();
  for (const [k, v] of into) into.set(k, v.replace(/\n{2,}/g, "\n").trim());
  return into;
}

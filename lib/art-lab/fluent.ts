/**
 * Minimal Fluent reader for the mod's message files: `key = value` with indented continuation lines.
 * Later files override earlier ones, as OpenRA's AddResourceOverriding does. Attributes are indexed as
 * message.attribute (used by Classic). Terms and selectors are kept verbatim, not evaluated.
 */
export function parseFluent(text: string, into: Map<string, string> = new Map()) {
  let key: string | null = null;
  let messageKey: string | null = null;
  let lines: string[] = [];
  const flush = () => {
    if (key) into.set(key, lines.join("\n").trim());
    key = null;
    lines = [];
  };
  for (const raw of text.split(/\r\n|\n/)) {
    if (/^\s*#/.test(raw)) { if (!/^\s/.test(raw)) flush(); continue; }
    const message = /^([A-Za-z][\w-]*)\s*=\s*(.*)$/.exec(raw);
    if (message) { flush(); messageKey = message[1]; key = messageKey; lines = [message[2]]; continue; }
    const attribute = /^\s+\.([\w-]+)\s*=\s*(.*)$/.exec(raw);
    if (attribute && messageKey) { flush(); key = `${messageKey}.${attribute[1]}`; lines = [attribute[2]]; continue; }
    if (key && /^\s+\S/.test(raw)) { lines.push(raw.trim()); continue; }
    if (!raw.trim()) { if (key) lines.push(""); continue; }
    flush(); messageKey = null;
  }
  flush();
  for (const [k, v] of into) into.set(k, v.replace(/\n{2,}/g, "\n").trim());
  return into;
}

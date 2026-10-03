/**
 * Finds which Python function in the OpenRA-AI art builders produced an output file, by reading the builder
 * source at the commit the provenance record pins. Static and best-effort: it follows the actor's entry in a
 * `models()`-style mapping (voxels) or the branch that names the actor (SHP infantry and defences).
 */
export type SourceAt = (path: string) => string | null;
export type FunctionRef = { name: string; file: string; line: number; part?: string };

const IDENT = /[A-Za-z_]\w*/;

function imports(source: string) {
  const aliases = new Map<string, string>();
  const names = new Map<string, string>();
  for (const line of source.split("\n")) {
    let m = /^import\s+(\w+)\s+as\s+(\w+)/.exec(line);
    if (m) { aliases.set(m[2], m[1]); continue; }
    m = /^import\s+(\w+)\s*$/.exec(line);
    if (m) { aliases.set(m[1], m[1]); continue; }
    m = /^from\s+(\w+)\s+import\s+(.+)$/.exec(line);
    if (m) for (const part of m[2].split(",")) {
      const [name, alias] = part.trim().split(/\s+as\s+/);
      if (IDENT.test(name)) names.set(alias ?? name, `${m[1]}:${name}`);
    }
  }
  return { aliases, names };
}

export function defLine(source: string, fn: string) {
  const lines = source.split("\n");
  const i = lines.findIndex(l => new RegExp(`^def\\s+${fn}\\s*\\(`).test(l));
  return i < 0 ? null : i + 1;
}

/** Splits `(a(), b(x, y))` or `a()` into top-level elements. */
function topLevelElements(expr: string) {
  let s = expr.trim();
  if (s.startsWith("(") && matchingParen(s, 0) === s.length - 1) s = s.slice(1, -1);
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (c === "," && depth === 0) { out.push(s.slice(start, i).trim()); start = i + 1; }
  }
  if (s.slice(start).trim()) out.push(s.slice(start).trim());
  return out;
}

function matchingParen(s: string, open: number) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** The expression for `"key": <expr>` in a dict literal, up to the next top-level comma or closing brace. */
function dictEntry(source: string, key: string) {
  const at = source.search(new RegExp(`["']${key}["']\\s*:`));
  if (at < 0) return null;
  const colon = source.indexOf(":", at);
  let depth = 0;
  let i = colon + 1;
  for (; i < source.length; i++) {
    const c = source[i];
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) { if (depth === 0) break; depth--; }
    else if (c === "," && depth === 0) break;
  }
  return { expr: source.slice(colon + 1, i).trim(), line: source.slice(0, at).split("\n").length };
}

function callsIn(expr: string) {
  const out: { qualifier: string | null; name: string }[] = [];
  for (const m of expr.matchAll(/(?:([A-Za-z_]\w*)\.)?([A-Za-z_]\w*)\s*\(/g)) {
    if (["range", "dict", "tuple", "list", "set", "len", "max", "min", "sum", "round", "abs", "zip", "float", "int", "str"].includes(m[2])) continue;
    out.push({ qualifier: m[1] ?? null, name: m[2] });
  }
  return out;
}

function resolveCall(call: { qualifier: string | null; name: string }, script: string, source: string, sourceAt: SourceAt): FunctionRef | null {
  const { aliases, names } = imports(source);
  let file = script;
  let fn = call.name;
  if (call.qualifier) {
    const moduleName = aliases.get(call.qualifier);
    if (!moduleName) return null;
    file = `scripts/${moduleName}.py`;
  } else if (names.has(call.name)) {
    const [moduleName, name] = names.get(call.name)!.split(":");
    file = `scripts/${moduleName}.py`;
    fn = name;
  }
  const text = file === script ? source : sourceAt(file);
  if (!text) return null;
  const line = defLine(text, fn);
  return line ? { name: fn, file, line } : null;
}

/** Voxel output `<actor>[tur]` -> the functions building that part. */
export function voxelGenerators(script: string, outputName: string, sourceAt: SourceAt): FunctionRef[] {
  const source = sourceAt(script);
  if (!source) return [];
  const candidates: { key: string; part: number }[] = [{ key: outputName, part: 0 }];
  if (outputName.endsWith("tur")) candidates.unshift({ key: outputName.slice(0, -3), part: 1 });
  const modules = [script, ...[...imports(source).names.values()].map(v => `scripts/${v.split(":")[0]}.py`)];
  for (const { key, part } of candidates) {
    for (const file of [...new Set(modules)]) {
      const text = file === script ? source : sourceAt(file);
      if (!text) continue;
      const entry = dictEntry(text, key);
      if (!entry) continue;
      const elements = topLevelElements(entry.expr);
      const element = elements.length > 1 ? elements[part] : elements[0];
      if (element === undefined) continue;
      const refs: FunctionRef[] = [{ name: `models()["${key}"]`, file, line: entry.line, part: part ? "turret/rotor (element 1)" : "body (element 0)" }];
      for (const call of callsIn(element)) {
        const ref = resolveCall(call, file, text, sourceAt);
        if (ref && !refs.some(r => r.file === ref.file && r.name === ref.name)) refs.push(ref);
      }
      return refs;
    }
  }
  // Loop-built models, e.g. `for name in ("luyang", "haiwang"): result["r2" + name] = (...)`.
  const short = outputName.replace(/tur$/, "").replace(/^r2/, "");
  for (const file of [...new Set(modules)]) {
    const text = file === script ? source : sourceAt(file);
    if (!text) continue;
    const lines = text.split("\n");
    const at = lines.findIndex(l => /^\s*for\s+\w+\s+in\b/.test(l) && new RegExp(`["']${short}["']`).test(l));
    if (at < 0) continue;
    const indent = /^\s*/.exec(lines[at])![0].length;
    let end = at + 1;
    while (end < lines.length && (lines[end].trim() === "" || /^\s*/.exec(lines[end])![0].length > indent)) end++;
    let owner: string | null = null;
    for (let i = at; i >= 0; i--) { const d = /^def\s+(\w+)/.exec(lines[i]); if (d) { owner = d[1]; break; } }
    const refs: FunctionRef[] = [{ name: `${owner ?? "module"}() loop over "${short}"`, file, line: at + 1, part: outputName.endsWith("tur") ? "turret (element 1)" : "body (element 0)" }];
    for (const call of callsIn(lines.slice(at + 1, end).join("\n"))) {
      const ref = resolveCall(call, file, text, sourceAt);
      if (ref && !refs.some(r => r.file === ref.file && r.name === ref.name)) refs.push(ref);
    }
    return refs;
  }
  return [];
}

/** SHP output for an actor -> the builder function(s) whose body names the actor, else the category builder. */
export function spriteGenerators(script: string, actor: string, category: "infantry" | "defense", sourceAt: SourceAt): FunctionRef[] {
  const source = sourceAt(script);
  if (!source) return [];
  const lines = source.split("\n");
  const refs: FunctionRef[] = [];
  let current: { name: string; line: number } | null = null;
  lines.forEach((line, i) => {
    const def = /^def\s+(\w+)\s*\(/.exec(line);
    if (def) current = { name: def[1], line: i + 1 };
    else if (/^\S/.test(line) && !/^(#|@)/.test(line)) current = null;
    if (current && new RegExp(`["']${actor}["']`).test(line) && /\bif\b|\belif\b|==|\bin\b|:/.test(line)) {
      const fn: { name: string; line: number } = current;
      const name = `${fn.name} — "${actor}" branch`;
      if (!refs.some(r => r.name === name)) refs.push({ name, file: script, line: i + 1 });
    }
  });
  const builder = category === "infantry" ? /^def\s+(soldier)\s*\(/ : /^def\s+(\w*fortification)\s*\(/;
  const builders = lines.flatMap((l, i) => (builder.test(l) ? [{ name: builder.exec(l)![1], line: i + 1 }] : []));
  // Prefer the builder the actor's branches live in (Red Sea has saudi_ and yemen_fortification).
  const chosen = builders.find(b => refs.some(r => r.name.startsWith(`${b.name} —`))) ?? builders[0];
  if (chosen) refs.unshift({ name: chosen.name, file: script, line: chosen.line });
  return refs;
}

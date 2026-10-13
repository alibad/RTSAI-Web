/**
 * OpenRA MiniYaml: parser and merge, ported from OpenRA.Game/MiniYaml.cs (GPL-3.0) so the Art Lab resolves
 * rules and sequences exactly as the engine does: tab or 4-space indentation, `#` comments (`\#` escapes),
 * `Inherits` / `Inherits@x` from `^templates`, `-Trait` removals, and later files overriding earlier ones.
 */

export type YamlNode = { key: string; value: Yaml; location: string };
export type Yaml = { value: string | null; nodes: YamlNode[] };

export class YamlError extends Error {}

const SPACES_PER_LEVEL = 4;

export function parseMiniYaml(text: string, name = "<string>"): YamlNode[] {
  type Line = { level: number; key: string; value: string | null; location: string };
  const lines: Line[] = [];
  const rows = text.split(/\r\n|\n/);
  for (let lineNo = 0; lineNo < rows.length; lineNo++) {
    const line = rows[lineNo];
    const location = `${name}:${lineNo + 1}`;
    let keyStart = 0;
    let level = 0;
    let spaces = 0;
    while (keyStart < line.length) {
      const c = line[keyStart];
      if (c === " ") {
        spaces++;
        if (spaces >= SPACES_PER_LEVEL) { spaces = 0; level++; }
        keyStart++;
      } else if (c === "\t") {
        level++;
        keyStart++;
      } else break;
    }

    let keyLength = line.length - keyStart;
    let valueStart = -1;
    let valueLength = 0;
    for (let i = 0; i < line.length; i++) {
      if (valueStart < 0 && line[i] === ":") {
        valueStart = i + 1;
        keyLength = i - keyStart;
        valueLength = line.length - i - 1;
      }
      if (line[i] === "#" && (i === 0 || line[i - 1] !== "\\")) {
        if (i <= keyStart + keyLength) keyLength = i - keyStart;
        else valueLength = i - valueStart;
        break;
      }
    }

    const key = keyLength > 0 ? line.slice(keyStart, keyStart + keyLength).trim() : "";
    let value: string | null = null;
    if (valueStart >= 0) {
      const trimmed = line.slice(valueStart, valueStart + valueLength).trim();
      if (trimmed.length > 0) value = trimmed;
    }
    if (value !== null && value.length > 1) {
      const trimLeading = value[0] === "\\" && (value[1] === " " || value[1] === "\t") ? 1 : 0;
      const trimTrailing = value[value.length - 1] === "\\" && (value[value.length - 2] === " " || value[value.length - 2] === "\t") ? 1 : 0;
      if (trimLeading + trimTrailing > 0) value = value.slice(trimLeading, value.length - trimTrailing);
      value = value.replaceAll("\\#", "#");
    }
    if (!key) continue;
    if (lines.length > 0 && lines[lines.length - 1].level < level - 1) throw new YamlError(`Bad indent in miniyaml at ${location}`);
    lines.push({ level, key, value, location });
  }

  const root: YamlNode[] = [];
  const stack: { level: number; nodes: YamlNode[] }[] = [{ level: -1, nodes: root }];
  for (const line of lines) {
    while (stack.length > 1 && stack[stack.length - 1].level >= line.level) stack.pop();
    const node: YamlNode = { key: line.key, value: { value: line.value, nodes: [] }, location: line.location };
    stack[stack.length - 1].nodes.push(node);
    stack.push({ level: line.level, nodes: node.value.nodes });
  }
  return root;
}

function withValue(node: YamlNode, value: Yaml): YamlNode {
  return node.value === value ? node : { key: node.key, value, location: node.location };
}

function lastIndexOfKey(nodes: YamlNode[], key: string) {
  for (let i = nodes.length - 1; i >= 0; i--) if (nodes[i].key === key) return i;
  return -1;
}

function weakResolveRemovals(nodes: YamlNode[] | undefined) {
  if (!nodes || nodes.length === 0) return nodes;
  const ret: YamlNode[] = [];
  for (const node of nodes) {
    if (node.key.startsWith("-")) {
      const removed = node.key.slice(1);
      for (let i = ret.length - 1; i >= 0; i--) if (ret[i].key === removed) ret.splice(i, 1);
    } else ret.push(node);
  }
  return ret;
}

function assertNoConflicts(nodes: YamlNode[] | undefined) {
  if (!nodes) return;
  const seen = new Map<string, YamlNode>();
  for (const node of nodes) {
    const previous = seen.get(node.key);
    if (previous) throw new YamlError(`MiniYaml.Merge: duplicate key ${node.key} (at ${previous.location}) and (at ${node.location})`);
    seen.set(node.key, node);
  }
}

function mergePartial(existing: Yaml | null, override: Yaml | null): Yaml {
  assertNoConflicts(weakResolveRemovals(existing?.nodes));
  assertNoConflicts(weakResolveRemovals(override?.nodes));
  if (existing === null) return override!;
  if (override === null) return existing;
  return { value: override.value ?? existing.value, nodes: mergePartialNodes(existing.nodes, override.nodes) };
}

function mergePartialNodes(existing: YamlNode[], override: YamlNode[]): YamlNode[] {
  if (existing.length === 0) return override;
  if (override.length === 0) return existing;
  const ret: YamlNode[] = [];
  const plainKeys = new Set<string>();
  const mergeNode = (node: YamlNode) => {
    if (node.key.startsWith("-")) { ret.push(node); return; }
    if (!plainKeys.has(node.key)) { plainKeys.add(node.key); ret.push(node); return; }
    const previous = lastIndexOfKey(ret, node.key);
    const previousRemoval = lastIndexOfKey(ret, `-${node.key}`);
    if (previousRemoval !== -1 && previousRemoval > previous) { ret.push(node); return; }
    ret[previous] = withValue(node, mergePartial(ret[previous].value, node.value));
  };
  existing.forEach(mergeNode);
  override.forEach(mergeNode);
  return ret;
}

function mergeSelfPartial(nodes: YamlNode[]): YamlNode[] {
  const ret: YamlNode[] = [];
  const index = new Map<string, number>();
  for (const node of nodes) {
    const at = index.get(node.key);
    if (at === undefined) { index.set(node.key, ret.length); ret.push(node); }
    else ret[at] = withValue(ret[at], mergePartial(ret[at].value, node.value));
  }
  return ret;
}

type Tree = Map<string, Yaml>;

function mergeIntoResolved(override: YamlNode, existingNodes: YamlNode[], existingKeys: Set<string>, tree: Tree, inherited: Map<string, string>, lenient = false) {
  let existingIndex = -1;
  if (existingKeys.has(override.key)) existingIndex = existingNodes.findIndex(n => n.key === override.key);
  else existingKeys.add(override.key);
  let value = mergePartial(existingIndex >= 0 ? existingNodes[existingIndex].value : null, override.value);
  const nodes = resolveInherits(value, tree, inherited, lenient);
  if (nodes !== value.nodes) value = { value: value.value, nodes };
  if (existingIndex >= 0) existingNodes[existingIndex] = withValue(existingNodes[existingIndex], value);
  else existingNodes.push(withValue(override, value));
}

/** `lenient` (another project's mod read without its engine): a parent or removal it cannot find is skipped. */
function resolveInherits(node: Yaml, tree: Tree, inheritedIn: Map<string, string>, lenient = false): YamlNode[] {
  if (node.nodes.length === 0) return node.nodes;
  let inherited = inheritedIn;
  const resolved: YamlNode[] = [];
  const keys = new Set<string>();
  for (const n of node.nodes) {
    if (n.key === "Inherits" || n.key.startsWith("Inherits@")) {
      const parentName = n.value.value ?? "";
      const parent = tree.get(parentName);
      if (!parent) { if (lenient) continue; throw new YamlError(`${n.location}: Parent type \`${parentName}\` not found`); }
      if (inherited.has(parentName)) { if (lenient) continue; throw new YamlError(`${n.location}: Parent type \`${parentName}\` was already inherited by this yaml tree at ${inherited.get(parentName)}`); }
      inherited = new Map(inherited).set(parentName, n.location);
      for (const r of resolveInherits(parent, tree, inherited, lenient)) mergeIntoResolved(r, resolved, keys, tree, inherited, lenient);
    } else if (n.key.startsWith("-")) {
      const removed = n.key.slice(1);
      let count = 0;
      for (let i = resolved.length - 1; i >= 0; i--) if (resolved[i].key === removed) { resolved.splice(i, 1); count++; }
      if (count === 0 && !lenient) throw new YamlError(`${n.location}: There are no elements with key \`${removed}\` to remove`);
      keys.delete(removed);
    } else mergeIntoResolved(n, resolved, keys, tree, inherited, lenient);
  }
  return resolved;
}

/** MiniYaml.Merge: later sources override earlier ones; inheritance and removals are resolved. */
export function mergeMiniYaml(sources: YamlNode[][], lenient = false): YamlNode[] {
  if (sources.length === 0) return [];
  const merged = sources.map(mergeSelfPartial).reduce((a, b) => mergePartialNodes(a, b));
  const tree: Tree = new Map();
  for (const n of merged) {
    if (tree.has(n.key)) { if (lenient) continue; throw new YamlError(`Duplicate top-level key ${n.key} at ${n.location}`); }
    tree.set(n.key, n.value);
  }
  const resolved: YamlNode[] = [];
  for (const [key, value] of tree) {
    const children = resolveInherits(value, tree, new Map([[key, ""]]), lenient);
    resolved.push({ key, value: { value: value.value, nodes: children }, location: key });
  }
  return resolveInherits({ value: "", nodes: resolved }, tree, new Map(), lenient);
}

export function child(yaml: Yaml | undefined, key: string): YamlNode | undefined {
  return yaml?.nodes.find(n => n.key === key);
}

export function childValue(yaml: Yaml | undefined, key: string): string | null {
  return child(yaml, key)?.value.value ?? null;
}

/** Trait instances of a type, e.g. `Armament` and `Armament@AA`; returns [instanceName, node]. */
export function traits(actor: Yaml, type: string): [string, YamlNode][] {
  return actor.nodes
    .filter(n => n.key === type || n.key.startsWith(`${type}@`))
    .map(n => [n.key.includes("@") ? n.key.slice(n.key.indexOf("@") + 1) : "", n]);
}

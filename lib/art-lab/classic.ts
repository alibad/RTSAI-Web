/** Loads the canonical Classic checkout's default experience without changing that checkout. */
import { child, childValue, parseMiniYaml } from "./miniyaml";
import { loadModData, type ModReader } from "./resolve";

export function loadDefaultExperienceData(reader: ModReader, options: Parameters<typeof loadModData>[1] = {}) {
  const manifestPath = options.manifestPath ?? 'mods/rtsai/mod.yaml';
  const catalogPath = manifestPath.replace(/mod\.yaml$/, 'experiences.yaml');
  if (!reader.exists(catalogPath)) return loadModData(reader, options);
  const catalog = parseMiniYaml(reader.text(catalogPath))[0].value;
  const components = child(catalog, "Components")?.value;
  const profile = child(child(catalog, "Profiles")?.value, childValue(catalog, "DefaultProfile") ?? "world-war-iii")?.value;
  const selected = new Set<string>();
  const list = (s: string | null) => (s ?? "").split(",").map(s => s.trim()).filter(Boolean);
  const visit = (id: string) => {
    if (selected.has(id)) return; selected.add(id);
    for (const dep of list(childValue(child(components, id)?.value, "Dependencies"))) visit(dep);
  };
  for (const id of list(childValue(profile, "Components"))) visit(id);
  const extra = Object.fromEntries((["Rules", "Weapons", "Sequences"] as const).map(key => [key,
    (components?.nodes ?? []).filter(q => selected.has(q.key)).flatMap(q => list(childValue(q.value, key)))]));
  return loadModData(reader, { ...options, extra });
}

export function loadClassicData(reader: ModReader) {
  return loadDefaultExperienceData(reader, { manifestPath: 'mods/ra/mod.yaml' });
}

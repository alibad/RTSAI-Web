/**
 * The measured results the art routes save next to a candidate, normalised for the Studio's Checks step.
 * Client-safe and pure: review-server.ts reads the files; this only reshapes what the tools recorded.
 *
 *   metrics.json (rtsai.*-metrics) the route's full record: per-check rows, family leave-one-out calibration
 *   gate.json / meta.gate        older summaries (gate.json is retired; meta.gate points to metrics.json)
 *   metrics-building.json        tools/metrics_building.py (defences and buildings)
 *   verify.json                  tools/infantry_route.py: structure + tools/metrics_infantry.py family gate
 *   meta.verify                  tools/building_sprites.py format checks
 *   meta.decodeCheck             the Studio's own VXL/HVA reader run on the files
 *   meta.qualityGate             older Forge gate (counts only)
 *
 * Every pass/fail shown is the one the tool recorded. Nothing here derives a pass from numbers.
 */

export type MeasuredRow = {
  metric: string;
  /** Plain name, e.g. "Size on screen". */
  label: string;
  /** The tool's own explanation of the check. */
  why: string;
  value: number | null;
  /** What stock measures, e.g. "stock 1910" or "stock 834–997". */
  stock: string | null;
  /** The allowed range, e.g. "≥ 149" or "1183–3431". */
  range: string | null;
  pass: boolean;
};
export type MeasuredGroup = {
  id: string;
  title: string;
  tool: string;
  file: string;
  /** Stock units this was compared against. */
  family: string[];
  /** The tool's overall verdict; null when the tool records none. */
  pass: boolean | null;
  rows: MeasuredRow[];
  /** The family gate is not calibrated (its own stock units do not all pass it): results are advisory. */
  advisory?: boolean;
  /** Facts without a verdict, e.g. "pixels changed outside the player areas: 0". */
  notes: string[];
  problems: string[];
};

const PLAIN: Record<string, string> = {
  area_px: "Size on screen", bbox_w: "Width", bbox_h: "Height", px_per_voxel: "Voxel density",
  luma_range: "Light-to-dark range", luma_std: "Value spread", luma_p05: "Darkest tones", luma_p95: "Brightest tones",
  intensity_std: "Shading range", albedo_cv: "Paint contrast", albedo_hf: "Fine surface noise", lit_top_share: "Lit top faces",
  normal_noise_deg: "Surface smoothness", edge_contrast: "Edge contrast against terrain", rim_delta: "Dark silhouette rim",
  edge_dark_share: "Dark outline", dark_share: "Deep recesses", bright_share: "Bright highlights", speckle: "Speckle",
  block_px: "Pixel block size", blocks_per_100px: "Shape detail", remap_share: "Player-colour area", remap_chroma: "Player-colour strength",
  remap_luma: "Player-colour brightness", remap_y: "Player-colour placement", local_contrast: "Local contrast", flat_share: "Flat areas",
  hard_step_share: "Hard value steps", pal_indices: "Palette colours used", rgb_colours: "Colours used", shadow_px: "Shadow size",
  vs_terrain_luma: "Brightness against terrain", vs_terrain_rgb: "Colour against terrain", edge_readable_share: "Readable outline",
};
export const plainMetric = (metric: string) => PLAIN[metric] ?? (metric.charAt(0).toUpperCase() + metric.slice(1)).replace(/_/g, " ");
export const plainCheck = (name: string) => {
  const words = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[-_]/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const fmt = (v: number) => (Math.abs(v) >= 100 ? String(Math.round(v)) : Math.abs(v) >= 10 ? v.toFixed(1) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(3));
function range(bounds: unknown): string | null {
  if (!Array.isArray(bounds)) return null;
  const [lo, hi] = [num(bounds[0]), num(bounds[1])];
  return lo !== null && hi !== null ? `${fmt(lo)}–${fmt(hi)}` : lo !== null ? `≥ ${fmt(lo)}` : hi !== null ? `≤ ${fmt(hi)}` : null;
}
type RawRow = { metric?: unknown; candidate?: unknown; value?: unknown; reference?: unknown; familyMin?: unknown; familyMax?: unknown; bounds?: unknown; pass?: unknown; why?: unknown };
function rows(raw: unknown): MeasuredRow[] {
  if (!Array.isArray(raw)) return [];
  return (raw as RawRow[]).filter(r => typeof r?.metric === "string" && typeof r.pass === "boolean").map(r => {
    const ref = num(r.reference), lo = num(r.familyMin), hi = num(r.familyMax);
    return {
      metric: r.metric as string, label: plainMetric(r.metric as string), why: typeof r.why === "string" ? r.why : "",
      value: num(r.candidate) ?? num(r.value), stock: ref !== null ? `stock ${fmt(ref)}` : lo !== null && hi !== null ? (lo === hi ? `stock ${fmt(lo)}` : `stock ${fmt(lo)}–${fmt(hi)}`) : null,
      range: range(r.bounds), pass: r.pass as boolean,
    };
  });
}
const family = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : typeof v === "string" ? [v] : []);
const bool = (v: unknown) => (typeof v === "boolean" ? v : null);

/** Builds the Checks step groups from the files a candidate directory holds (parsed JSON by file name) and its meta. */
export function measuredGroups(files: Record<string, unknown>, meta: Record<string, unknown>): MeasuredGroup[] {
  const out: MeasuredGroup[] = [];
  const group = (g: Omit<MeasuredGroup, "notes" | "problems"> & Partial<Pick<MeasuredGroup, "notes" | "problems">>) => out.push({ notes: [], problems: [], ...g });
  // The route's full record (schema rtsai.<kind>-metrics/N): per-check rows and the family's own calibration.
  const full = files["metrics.json"] as Record<string, unknown> | undefined;
  const fullOk = typeof full?.schema === "string" && /^rtsai\.[a-z]+-metrics\//.test(full.schema) && Array.isArray(full.checks);
  if (full && fullOk) {
    const loo = Array.isArray(full.familyLeaveOneOut) ? (full.familyLeaveOneOut as { unit?: unknown; pass?: unknown }[]).filter(x => typeof x.pass === "boolean") : [];
    const advisory = full.familyCalibrated === false;
    const size = full.size as { areaPx?: unknown; targetPx?: unknown; inTarget?: unknown } | undefined;
    const sizeRow: MeasuredRow[] = size && typeof size.inTarget === "boolean" ? [{
      metric: "size_target", label: "Size for its role", why: "on-screen area against the role's size target",
      value: num(size.areaPx), stock: null, range: num(size.targetPx) !== null ? `target ${fmt(num(size.targetPx)!)}` : null, pass: size.inTarget,
    }] : [];
    group({ id: "family", title: advisory ? "Against the stock family (advisory)" : "Against the stock family", tool: typeof full.tool === "string" ? full.tool : "art_metrics.py", file: "metrics.json", family: family(full.family), pass: bool(full.pass), rows: [...sizeRow, ...rows(full.checks)], advisory,
      notes: [
        ...(advisory ? ["Advisory: this family's own stock units do not all pass the gate, so it is not a firm verdict"] : []),
        ...(loo.length ? [`Calibration: ${loo.filter(x => x.pass).length} of ${loo.length} stock units pass the same gate against the rest of their family`] : []),
      ] });
    const colour = full.playerColor as { sharePx?: unknown; chroma?: unknown; changedOutsideOwnership?: unknown; houses?: unknown } | undefined;
    if (colour && typeof colour.changedOutsideOwnership === "number") group({ id: "colours", title: "Player colours", tool: "metrics.json", file: "metrics.json (playerColor)", family: [], pass: null, rows: [],
      notes: [`${Array.isArray(colour.houses) ? colour.houses.length : "?"} colours tried; ${colour.changedOutsideOwnership} pixels changed outside the player-colour areas${num(colour.sharePx) !== null ? `; player colour covers ${(num(colour.sharePx)! * (num(colour.sharePx)! <= 1 ? 100 : 1)).toFixed(1)}${num(colour.sharePx)! <= 1 ? "%" : " px"}` : ""}`] });
    const decode = full.decode as { pass?: unknown; problems?: unknown; tool?: unknown } | undefined;
    if (decode && typeof decode.pass === "boolean") group({ id: "decode", title: "Decodes in the Studio", tool: typeof decode.tool === "string" ? decode.tool : "decode check", file: "metrics.json (decode)", family: [], pass: decode.pass, rows: [], problems: Array.isArray(decode.problems) ? decode.problems.map(String) : [] });
  }
  // Vehicles, ships, aircraft: art_metrics.py through glb_route.py (gate.json, mirrored into meta.gate).
  const gate = (files["gate.json"] ?? meta.gate) as Record<string, unknown> | undefined;
  if (!fullOk && gate && Array.isArray(gate.rows)) group({ id: "family", title: "Against the stock family", tool: "art_metrics.py", file: files["gate.json"] ? "gate.json" : "meta.json (gate)", family: family(gate.family), pass: bool(gate.pass), rows: rows(gate.rows) });
  else if (!fullOk && gate && typeof gate.pass === "boolean") group({ id: "family", title: "Against the stock family", tool: "art_metrics.py", file: "meta.json (gate)", family: family(gate.family), pass: gate.pass, rows: [],
    notes: [`Per-check results are in ${typeof gate.metrics === "string" ? gate.metrics : "the route's metrics file"}, which is not readable here`] });
  // Defences and buildings: metrics_building.py.
  const building = files["metrics-building.json"] as Record<string, unknown> | undefined;
  if (building && Array.isArray(building.rows)) group({ id: "family", title: "Against the stock family", tool: "metrics_building.py", file: "metrics-building.json", family: [...family(building.family), ...family(building.members).map(m => `${m}`)].filter((v, i, a) => a.indexOf(v) === i), pass: bool(building.pass), rows: rows(building.rows) });
  // meta.metrics is the route's summary of that file and can lag behind a re-render (Signal Post kept an old
  // "fail" beside a passing file). The file written with the art is the record; the summary counts only without it.
  const summary = meta.metrics as Record<string, unknown> | undefined;
  if (!(building && Array.isArray(building.rows)) && summary && typeof summary.pass === "boolean" && summary.file === "metrics-building.json") group({
    id: "family", title: "Against the stock family", tool: "metrics_building.py", file: "meta.json (metrics)", family: [...family(summary.family), ...family(summary.members)], pass: summary.pass, rows: [],
    notes: ["Summary only: metrics-building.json is not readable here"], problems: Array.isArray(summary.fails) ? summary.fails.map(f => plainMetric(String(f))) : [],
  });
  // Infantry: infantry_route.py writes the structure checks and metrics_infantry.py's family gate.
  const verify = files["verify.json"] as Record<string, unknown> | undefined;
  const fam = verify?.family as Record<string, unknown> | undefined;
  if (fam && Array.isArray(fam.rows)) group({ id: "family", title: "Against the stock family", tool: "metrics_infantry.py", file: "verify.json", family: Object.keys((fam.extras as Record<string, unknown> | undefined) ?? {}).filter(k => k !== "candidate"), pass: bool(fam.pass), rows: rows(fam.rows) });
  const structure = verify?.structure as Record<string, unknown> | undefined;
  if (structure && typeof structure.ok === "boolean") group({
    id: "structure", title: "SHP structure", tool: "metrics_infantry.py", file: "verify.json", family: [], pass: structure.ok, rows: [],
    problems: Array.isArray(structure.problems) ? structure.problems.map(String) : [],
    notes: [
      typeof structure.frames === "number" ? `${structure.frames} frames` : null,
      Array.isArray(structure.clippedFrames) ? `${structure.clippedFrames.length} clipped frames` : null,
      typeof structure.remapOutsideOwnership === "number" ? `${structure.remapOutsideOwnership} player-colour pixels outside the owned areas` : null,
    ].filter((n): n is string => Boolean(n)),
  });
  // Buildings: building_sprites.py format checks, each recorded true/false.
  const formatChecks = (meta.verify as { checks?: Record<string, unknown> } | undefined)?.checks;
  if (formatChecks && Object.keys(formatChecks).length) group({
    id: "format", title: "Format checks", tool: "building_sprites.py", file: "meta.json (verify)", family: [], pass: bool((meta.verify as Record<string, unknown>).pass),
    rows: Object.entries(formatChecks).filter(([, v]) => typeof v === "boolean").map(([k, v]) => ({ metric: k, label: plainCheck(k), why: "", value: null, stock: null, range: null, pass: v as boolean })),
  });
  const decode = meta.decodeCheck as { pass?: unknown; problems?: unknown; tool?: unknown } | undefined;
  if (!fullOk && decode && typeof decode.pass === "boolean") group({ id: "decode", title: "Decodes in the Studio", tool: typeof decode.tool === "string" ? decode.tool : "decode check", file: "meta.json (decodeCheck)", family: [], pass: decode.pass, rows: [], problems: Array.isArray(decode.problems) ? decode.problems.map(String) : [] });
  const colour = meta.playerColorCheck as { houses?: unknown; changedOutsideOwnership?: unknown } | undefined;
  if (!fullOk && colour && typeof colour.changedOutsideOwnership === "number") group({ id: "colours", title: "Player colours", tool: "glb_route.py", file: "meta.json (playerColorCheck)", family: [], pass: null, rows: [],
    notes: [`${Array.isArray(colour.houses) ? colour.houses.length : "?"} colours tried; ${colour.changedOutsideOwnership} pixels changed outside the player-colour areas`] });
  const quality = meta.qualityGate as { passes?: unknown; checksPassed?: unknown; checksTotal?: unknown; references?: unknown } | undefined;
  if (quality && typeof quality.checksPassed === "number" && typeof quality.checksTotal === "number") group({ id: "family", title: "Numerical gate (earlier Forge)", tool: "art_metrics.py", file: "meta.json (qualityGate)", family: family(quality.references), pass: bool(quality.passes), rows: [],
    notes: [`${quality.checksPassed} of ${quality.checksTotal} checks passed`] });
  return out;
}

/** Files the Studio reads from a candidate directory for its checks (small JSON only). */
export const MEASUREMENT_FILES = ["metrics.json", "gate.json", "metrics-building.json", "verify.json"] as const;

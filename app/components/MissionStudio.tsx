"use client";

import {
  Check,
  Crosshair,
  Download,
  LoaderCircle,
  LocateFixed,
  MapPin,
  Play,
  RefreshCw,
  Save,
  Search,
  Share2,
  Shuffle,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import { compileBattlefield, type Battlefield, type EarthEvidence } from "../../lib/earth-battlefield";
import { decodeMissionBlueprint, encodeMissionBlueprint } from "../../lib/mission-blueprint";
import { deleteSavedMap, listSavedMaps, playSavedMapUrl, saveBattlefield, type SavedMapSummary } from "../../lib/saved-maps";
import { useAuth } from "./AuthProvider";
import { trackAnalyticsEvent } from "../../lib/firebase-client";
import { OptionSelect, type Option } from "./ui/fields";
import { Popover, PopoverContent } from "./ui/popover";

type LocationResult = { latitude: number; longitude: number; label: string; kind?: string };
type Size = 48 | 64 | 80;
type Players = 2 | 4;
type Generated = { map: Battlefield; previewUrl: string; downloadUrl: string; filename: string };

// The sizes the game's own map studio offers (RTSAI-Mod tools/earth-battlefield.py): S × 2S isometric cells.
const sizeOptions: Option<Size>[] = [{ value: 48, label: "Small · quick match" }, { value: 64, label: "Medium" }, { value: 80, label: "Large" }];
const playerOptions: Option<Players>[] = [{ value: 2, label: "2 players" }, { value: 4, label: "4 players" }];
const footprintOptions: Option<number>[] = [{ value: 2000, label: "4 km · Local" }, { value: 3500, label: "7 km · District" }, { value: 6000, label: "12 km · Regional" }];

const presets = [
  { label: "Riyadh", latitude: 24.7136, longitude: 46.6753 },
  { label: "Manhattan", latitude: 40.7128, longitude: -74.006 },
  { label: "Tokyo Bay", latitude: 35.6329, longitude: 139.797 },
  { label: "Cape Town", latitude: -33.9249, longitude: 18.4241 },
];

function randomInteger(max: number) {
  const value = new Uint32Array(1);
  window.crypto.getRandomValues(value);
  return value[0] % max;
}

/** Roads, water, land cover and buildings around the pin, from OpenStreetMap (app/api/earth-features, detail: terrain). */
async function fetchEvidence(where: { latitude: number; longitude: number; radiusM: number }, authToken: string, signal: AbortSignal): Promise<EarthEvidence[]> {
  const response = await fetch("/api/earth-features", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({ ...where, detail: "terrain" }),
    signal,
  });
  const payload = (await response.json().catch(() => ({}))) as { features?: EarthEvidence[]; error?: string };
  if (response.status === 401) throw new Error("Your session expired. Sign in again to build this battlefield.");
  if (!response.ok) throw new Error(payload.error ?? "Map data is temporarily unavailable. Try again in a moment.");
  return payload.features ?? [];
}

export function MissionStudio() {
  const { user, loading: authLoading, openAuth } = useAuth();
  const mapNode = useRef<HTMLDivElement>(null);
  const searchField = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const firstResult = useRef<HTMLButtonElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const generationControllerRef = useRef<AbortController | null>(null);
  const [latitude, setLatitude] = useState(24.7136);
  const [longitude, setLongitude] = useState(46.6753);
  const [title, setTitle] = useState("Riyadh Crossing");
  const [seed, setSeed] = useState(42);
  const [story, setStory] = useState("A contested supply corridor cuts across the city edge.");
  const [size, setSize] = useState<Size>(64);
  const [players, setPlayers] = useState<Players>(2);
  const [radiusM, setRadiusM] = useState(3500);
  const [selectedPlace, setSelectedPlace] = useState("Riyadh, Saudi Arabia");
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<LocationResult[]>([]);
  const [status, setStatus] = useState<"idle" | "locating" | "acquiring" | "compiling" | "ready" | "error">("idle");
  const [mission, setMission] = useState<Generated | null>(null);
  const [error, setError] = useState("");
  const [generationMs, setGenerationMs] = useState(0);
  const [shareStatus, setShareStatus] = useState<"idle" | "copied" | "error">("idle");
  // The saved id belongs to the battlefield it was saved from; a new build starts unsaved.
  const [savedAs, setSavedAs] = useState<{ map: Battlefield; id: string } | null>(null);
  const [saving, setSaving] = useState<"idle" | "saving" | "playing">("idle");
  const [savedMaps, setSavedMaps] = useState<SavedMapSummary[]>([]);
  const [savedVersion, setSavedVersion] = useState(0);
  const savedId = savedAs && savedAs.map === mission?.map ? savedAs.id : null;

  useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | null = null;
    void import("maplibre-gl").then((maplibre) => {
      if (cancelled || !mapNode.current) return;
      const shared = decodeMissionBlueprint(new URLSearchParams(window.location.search));
      const initialLatitude = shared?.latitude ?? latitude;
      const initialLongitude = shared?.longitude ?? longitude;
      if (shared) {
        setLatitude(shared.latitude);
        setLongitude(shared.longitude);
        setTitle(shared.title);
        setSelectedPlace(shared.place);
        setRadiusM(shared.radiusM);
        setSize(shared.size);
        setPlayers(shared.players);
        setSeed(shared.seed);
        setStory(shared.story);
      }
      map = new maplibre.Map({
        container: mapNode.current,
        center: [initialLongitude, initialLatitude],
        zoom: 10.4,
        attributionControl: false,
        style: {
          version: 8,
          sources: {
            osm: {
              type: "raster",
              tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
              tileSize: 256,
              attribution: "© OpenStreetMap contributors",
            },
          },
          layers: [{ id: "osm", type: "raster", source: "osm", paint: { "raster-saturation": -0.78, "raster-contrast": 0.14, "raster-brightness-max": 0.72 } }],
        },
      });
      map.addControl(new maplibre.NavigationControl({ showCompass: false }), "bottom-right");
      markerRef.current = new maplibre.Marker({ color: "#ef5b3f" }).setLngLat([initialLongitude, initialLatitude]).addTo(map);
      map.on("click", (event) => {
        const lat = Number(event.lngLat.lat.toFixed(5));
        const lon = Number(event.lngLat.lng.toFixed(5));
        setLatitude(lat);
        setLongitude(lon);
        setSelectedPlace(`Pinned at ${lat.toFixed(4)}, ${lon.toFixed(4)}`);
        markerRef.current?.setLngLat([lon, lat]);
        setMission(null);
        setStatus("idle");
        setError("");
        setSearchResults([]);
      });
      mapRef.current = map;
    });
    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
    };
    // The map owns subsequent coordinate updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => generationControllerRef.current?.abort(), []);

  useEffect(() => {
    const urls = mission ? [mission.downloadUrl, mission.previewUrl] : [];
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [mission]);

  useEffect(() => {
    if (!user) return;
    let live = true;
    listSavedMaps(user.uid).then((maps) => {
      if (live) setSavedMaps((previous) => { previous.forEach((m) => m.previewUrl && URL.revokeObjectURL(m.previewUrl)); return maps; });
    }).catch(() => { /* the list is a convenience; the studio works without it */ });
    return () => { live = false; };
  }, [user, savedVersion]);

  function moveTo(next: { label: string; latitude: number; longitude: number }, fullLabel = next.label) {
    setLatitude(next.latitude);
    setLongitude(next.longitude);
    setTitle(`${next.label} Crossing`);
    setSelectedPlace(fullLabel);
    markerRef.current?.setLngLat([next.longitude, next.latitude]);
    mapRef.current?.flyTo({ center: [next.longitude, next.latitude], zoom: 10.5 });
    setMission(null);
    setStatus("idle");
    setError("");
    setSearchResults([]);
    setShareStatus("idle");
  }

  async function locate() {
    if (!search.trim()) return;
    setStatus("locating");
    setError("");
    try {
      const response = await fetch(`/api/geocode?q=${encodeURIComponent(search)}`);
      if (!response.ok) throw new Error("Place search is unavailable");
      const payload = (await response.json()) as { results?: LocationResult[] };
      const results = payload.results ?? [];
      void trackAnalyticsEvent("place_search", { result_count: results.length });
      if (!results.length) throw new Error("No place matched that search");
      setSearchResults(results);
      setStatus("idle");
      if (results.length === 1) chooseLocation(results[0]);
    } catch (cause) {
      setStatus("error");
      setError(cause instanceof Error ? cause.message : "Could not locate that place");
    }
  }

  function chooseLocation(result: LocationResult) {
    moveTo({ label: result.label.split(",")[0], latitude: result.latitude, longitude: result.longitude }, result.label);
    setSearch("");
  }

  async function generate(nextSeed = seed) {
    if (!user) {
      void trackAnalyticsEvent("auth_gate_view", { feature: "mission_generation" });
      openAuth("Create an account to build and play this battlefield");
      return;
    }
    generationControllerRef.current?.abort();
    const controller = new AbortController();
    generationControllerRef.current = controller;
    const startedAt = performance.now();
    setStatus("acquiring");
    setError("");
    setMission(null);
    setGenerationMs(0);
    void trackAnalyticsEvent("mission_generation_started", { map_size: size, players, footprint_km: Math.round(radiusM * 2 / 1000) });
    try {
      const features = await fetchEvidence({ latitude, longitude, radiusM }, await user.getIdToken(), controller.signal);
      if (controller.signal.aborted) throw new DOMException("Cancelled", "AbortError");
      setStatus("compiling");
      const map = await compileBattlefield({ latitude, longitude, radius: radiusM, seed: nextSeed, size, players, title }, features);
      if (controller.signal.aborted) throw new DOMException("Cancelled", "AbortError");
      const slug = map.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "earth-battlefield";
      setMission({
        map,
        previewUrl: URL.createObjectURL(new Blob([map.png.slice()], { type: "image/png" })),
        downloadUrl: URL.createObjectURL(new Blob([map.oramap.slice()], { type: "application/zip" })),
        filename: `${slug}-${nextSeed}.oramap`,
      });
      setGenerationMs(Math.round(performance.now() - startedAt));
      setStatus("ready");
      void trackAnalyticsEvent("mission_generation_completed", {
        map_size: size,
        players,
        footprint_km: Math.round(radiusM * 2 / 1000),
        duration_band: performance.now() - startedAt < 5000 ? "under_5s" : "5s_or_more",
      });
    } catch (cause) {
      if (controller.signal.aborted) {
        setStatus("idle");
        setError("Cancelled. Your setup is kept.");
        return;
      }
      setStatus("error");
      setError(cause instanceof Error ? cause.message : "This battlefield couldn't be built. Try another seed or place.");
      void trackAnalyticsEvent("mission_generation_failed", { stage: status });
    } finally {
      if (generationControllerRef.current === controller) generationControllerRef.current = null;
    }
  }

  function cancelGeneration() {
    generationControllerRef.current?.abort();
  }

  /** Saves the battlefield once; returns its saved id. */
  async function save(): Promise<string | null> {
    if (!user || !mission) return null;
    if (savedId) return savedId;
    const id = await saveBattlefield(user.uid, mission.map, { place: selectedPlace, latitude, longitude, radius: radiusM, seed });
    setSavedAs({ map: mission.map, id });
    void trackAnalyticsEvent("map_saved", { map_size: mission.map.size, players: mission.map.players });
    setSavedVersion((v) => v + 1);
    return id;
  }

  async function saveOnly() {
    setSaving("saving");
    setError("");
    try { await save(); } catch { setError("Couldn't save this map. Check your connection and try again."); } finally { setSaving("idle"); }
  }

  async function playInBrowser() {
    setSaving("playing");
    setError("");
    try {
      const id = await save();
      if (!id) return;
      void trackAnalyticsEvent("map_played_in_browser", { map_size: mission?.map.size ?? size });
      window.location.assign(playSavedMapUrl(id));
    } catch {
      setError("Couldn't save this map. Check your connection and try again.");
      setSaving("idle");
    }
  }

  async function removeSaved(map: SavedMapSummary) {
    if (!window.confirm(`Delete “${map.title}”? Games already using it keep working until they end.`)) return;
    try {
      await deleteSavedMap(map.saved);
      if (map.saved === savedId) setSavedAs(null);
      setSavedMaps((maps) => maps.filter((m) => m.saved !== map.saved));
    } catch {
      setError("Couldn't delete that map. Try again.");
    }
  }

  async function copyBlueprint() {
    try {
      const url = new URL(window.location.href);
      url.search = encodeMissionBlueprint({ latitude, longitude, title, place: selectedPlace, radiusM, size, players, seed, story }).toString();
      url.hash = "mission-studio";
      await navigator.clipboard.writeText(url.toString());
      setShareStatus("copied");
      void trackAnalyticsEvent("mission_blueprint_shared");
      window.setTimeout(() => setShareStatus("idle"), 2200);
    } catch {
      setShareStatus("error");
    }
  }

  function generateVariation() {
    const nextSeed = (seed + 7919) % 2_147_483_647;
    setSeed(nextSeed);
    void trackAnalyticsEvent("mission_variation_requested", { map_size: size });
    void generate(nextSeed);
  }

  function clearGeneratedMission() {
    generationControllerRef.current?.abort();
    setMission(null);
    setStatus("idle");
    setError("");
    setGenerationMs(0);
    setShareStatus("idle");
  }

  function rerollSeed() {
    setSeed(randomInteger(2_147_483_647));
    clearGeneratedMission();
  }

  function surpriseMe() {
    const next = presets[randomInteger(presets.length)];
    moveTo(next);
    setSeed(randomInteger(999_999));
    setStory(`A fictional flashpoint forms around the approaches to ${next.label}. Secure the routes and control the resources.`);
  }

  const pipelineStep = status === "ready" ? 4 : status === "compiling" ? 3 : status === "acquiring" ? 2 : status === "locating" ? 1 : 0;
  const report = mission?.map.report;

  return (
    <section className="studio-shell" id="mission-studio" aria-labelledby="studio-title">
      <div className="studio-heading">
        <div>
          <span className="eyebrow"><Crosshair size={14} /> 03 / Mission studio / alpha</span>
          <h2 id="studio-title">Point anywhere. Leave with a battlefield.</h2>
        </div>
        <p>Search or click anywhere, choose the size, then build an RTS AI battlefield in your browser. Play it right away, alone or with friends.</p>
      </div>

      <div className="studio-grid">
        <div className="map-panel">
          <div className="map-toolbar">
            <div className="search-field" ref={searchField}>
              <Search size={16} aria-hidden="true" />
              <input
                ref={searchInput}
                value={search}
                onChange={(event) => { setSearch(event.target.value); setSearchResults([]); }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void locate();
                  if (event.key === "Escape") setSearchResults([]);
                }}
                placeholder="Find a city, coast, or landmark"
                aria-label="Find a location"
                aria-controls="location-results"
              />
              <button onClick={() => void locate()} aria-label="Search location" disabled={status === "locating"}>
                {status === "locating" ? <LoaderCircle className="spin" size={14} /> : "Go"}
              </button>
            </div>
            <Popover open={searchResults.length > 0} onOpenChange={(open) => { if (!open) setSearchResults([]); }} modal={false}>
              <PopoverContent anchor={searchField} align="start" sideOffset={6} initialFocus={firstResult} finalFocus={searchInput} id="location-results" aria-label={`${searchResults.length} location results`} className="location-results location-results-popup ui-paper">
                <div><span>Choose the exact place</span><button onClick={() => setSearchResults([])} aria-label="Close location results"><X size={14} /></button></div>
                <ul>
                  {searchResults.map((result, index) => {
                    const [name, ...detail] = result.label.split(",");
                    return <li key={`${result.latitude}-${result.longitude}`}><button ref={index === 0 ? firstResult : undefined} onClick={() => chooseLocation(result)}><strong>{name}</strong><span>{detail.join(",").trim()}</span><small>{result.kind ?? "place"}</small></button></li>;
                  })}
                </ul>
              </PopoverContent>
            </Popover>
            <span className="coordinates"><LocateFixed size={14} /> {latitude.toFixed(4)}, {longitude.toFixed(4)}</span>
          </div>
          <div ref={mapNode} className="map-canvas" aria-label="Interactive location map" />
          <div className="map-scale-overlay" aria-hidden="true"><span />{(radiusM * 2 / 1000).toFixed(0)} km battlefield capture</div>
          <div className="map-presets">
            {presets.map((preset) => <button key={preset.label} onClick={() => moveTo(preset)}>{preset.label}</button>)}
            <button className="surprise-button" onClick={surpriseMe}><Shuffle size={13} /> Surprise me</button>
          </div>
          <span className="map-attribution">Map data © OpenStreetMap contributors</span>
        </div>

        <div className="mission-panel">
          <div className="mission-form">
            <div className="selection-status">
              <span>EARTH SELECTION</span>
              <strong>{selectedPlace}</strong>
              <small>{(radiusM * 2 / 1000).toFixed(0)} km footprint · {size} × {size * 2} cells</small>
            </div>
            <label>
              Map name
              <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} />
            </label>
            <div className="mission-selectors mission-selectors-3">
              <label>
                Size
                <OptionSelect value={size} onValueChange={(value) => { setSize(value); clearGeneratedMission(); }} options={sizeOptions} contentClassName="ui-paper" />
              </label>
              <label>
                Players
                <OptionSelect value={players} onValueChange={(value) => { setPlayers(value); clearGeneratedMission(); }} options={playerOptions} contentClassName="ui-paper" />
              </label>
              <label>
                Earth footprint
                <OptionSelect value={radiusM} onValueChange={(value) => { setRadiusM(value); clearGeneratedMission(); }} options={footprintOptions} contentClassName="ui-paper" />
              </label>
            </div>
            <div className="variation-control">
              <label className="variation-copy" htmlFor="mission-seed">
                <span>Variation seed</span>
                <small>Same seed reproduces the same terrain</small>
              </label>
              <input id="mission-seed" type="number" min={0} max={2147483647} value={seed} onChange={(event) => { setSeed(Number(event.target.value) || 0); clearGeneratedMission(); }} />
              <button type="button" className="reroll-button" onClick={rerollSeed}><Shuffle size={14} /> Reroll</button>
            </div>
            <div className="generation-actions">
              <button className="generate-button" onClick={() => void generate()} disabled={authLoading || status === "acquiring" || status === "compiling"}>
                {status === "acquiring" || status === "compiling" ? <LoaderCircle className="spin" size={18} /> : <Sparkles size={18} />}
                {status === "acquiring" ? "Reading the map data…" : status === "compiling" ? "Building the battlefield…" : "Build battlefield"}
              </button>
              {(status === "acquiring" || status === "compiling") && <button className="cancel-generation" onClick={cancelGeneration}><X size={15} /> Cancel</button>}
            </div>
            {!authLoading && !user && <button type="button" className="generation-auth-note" onClick={() => openAuth("Create an account to build and play this battlefield")}><span>Free account required</span><b>Sign in or create a free profile →</b></button>}
            {error && <p className="studio-error" role="alert">{error}</p>}
            <div className="generation-pipeline" aria-live="polite" aria-label="Battlefield build steps">
              {["Pin Earth", "Read geometry", "Build terrain", "Validate map"].map((label, index) => (
                <span key={label} className={status === "ready" || pipelineStep > index + 1 ? "complete" : pipelineStep === index + 1 ? "active" : ""}>
                  <i>{status === "ready" || pipelineStep > index + 1 ? <Check size={12} /> : index + 1}</i><b>{label}</b>
                </span>
              ))}
            </div>
          </div>

          {mission && report ? (
            <div className="mission-result" aria-live="polite">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={mission.previewUrl} alt={`Overview of ${mission.map.title}`} />
              <div className="result-copy">
                <div className="result-topline"><span className="result-ready"><Check size={15} /> Ready to play</span><span className="source-badge live">OpenStreetMap</span></div>
                <h3>{mission.map.title}</h3>
                <p>{Object.values(report.features).reduce((n, c) => n + c, 0).toLocaleString("en-US")} roads, rivers, buildings and land areas from OpenStreetMap, built into terrain in {(generationMs / 1000).toFixed(1)}s.</p>
                <div className="result-stats">
                  <span>{mission.map.size}×{mission.map.size * 2}<small>cells</small></span>
                  <span>{mission.map.players}<small>players</small></span>
                  <span>{report.validation.homeMines}<small>ore mines</small></span>
                </div>
                <ul className="validation-list">
                  <li><Check size={11} />Every base reaches every other by land</li>
                  <li><Check size={11} />Clear ground around each base</li>
                  <li><Check size={11} />Ore at every base and gems in the middle</li>
                </ul>
                <div className="result-actions">
                  <button className="download-button" onClick={() => void playInBrowser()} disabled={saving !== "idle"}>{saving === "playing" ? <LoaderCircle className="spin" size={17} /> : <Play size={17} />} Play in browser</button>
                  <button onClick={() => void saveOnly()} disabled={saving !== "idle" || !!savedId}>{saving === "saving" ? <LoaderCircle className="spin" size={14} /> : savedId ? <Check size={14} /> : <Save size={14} />}{savedId ? "Saved" : "Save map"}</button>
                  <a className="result-link" href={mission.downloadUrl} download={mission.filename} onClick={() => void trackAnalyticsEvent("mission_download", { map_size: mission.map.size })}><Download size={14} /> Download .oramap</a>
                  <button onClick={() => void copyBlueprint()}><Share2 size={14} />{shareStatus === "copied" ? "Link copied" : shareStatus === "error" ? "Copy failed" : "Share setup"}</button>
                  <button onClick={generateVariation}><RefreshCw size={14} />New variation</button>
                </div>
                <small className="install-note">Saved maps appear in the game&rsquo;s skirmish and multiplayer map lists. Friends you play with get your map automatically.</small>
              </div>
            </div>
          ) : (
            <div className="mission-placeholder">
              <MapPin size={20} />
              <div><strong>Your battlefield appears here.</strong><span>Earth geometry · routes · bases · resources · checks</span></div>
            </div>
          )}

          {user && savedMaps.length > 0 && (
            <div className="saved-maps" aria-label="Your saved maps">
              <div className="saved-maps-head"><strong>Your saved maps</strong><span>{savedMaps.length}</span></div>
              <ul>
                {savedMaps.map((m) => (
                  <li key={m.saved}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {m.previewUrl ? <img src={m.previewUrl} alt="" /> : <span className="saved-maps-blank" />}
                    <div><b>{m.title}</b><small>{[m.place, `${m.players} players`].filter(Boolean).join(" · ")}</small></div>
                    <a href={playSavedMapUrl(m.saved)} onClick={() => void trackAnalyticsEvent("map_played_in_browser", { map_size: m.size, from: "saved_list" })}><Play size={13} /> Play</a>
                    <button onClick={() => void removeSaved(m)} aria-label={`Delete ${m.title}`}><Trash2 size={13} /></button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

"use client";

import { useMemo, useState } from "react";
import { ArrowUpRight, ChevronDown, Search, ShieldCheck } from "lucide-react";
import { capabilities, capabilityCategories, type CapabilityCategory } from "../../lib/capabilities";

type Filter = "all" | CapabilityCategory;

export function CapabilityAtlas() {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const visibleCapabilities = useMemo(() => capabilities.filter((capability) => {
    if (filter !== "all" && capability.category !== filter) return false;
    if (!normalizedQuery) return true;
    const searchableText = [
      capability.title,
      capability.summary,
      capability.playerExperience,
      capability.howItWorks,
      capability.surface,
      ...(capability.searchTerms ?? []),
    ].join(" ").toLowerCase();
    const queryTerms = normalizedQuery.split(/\s+/).map((term) => term.length > 3 && term.endsWith("s") ? term.slice(0, -1) : term);
    return queryTerms.every((term) => searchableText.includes(term));
  }), [filter, normalizedQuery]);

  return (
    <section className="atlas-shell" aria-labelledby="atlas-title">
      <div className="atlas-heading">
        <div>
          <span className="section-number">CAPABILITY ATLAS</span>
          <h2 id="atlas-title">Scan the surface.<br />Open the engineering.</h2>
        </div>
        <p>Every card starts with the player outcome. Expand it for implementation detail, proof, and the boundary that keeps the feature honest.</p>
      </div>

      <div className="atlas-controls">
        <label className="atlas-search">
          <Search size={17} aria-hidden="true" />
          <span className="sr-only">Search capabilities</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search voice, local models, maps, agents..." />
        </label>
        <div className="atlas-filters" aria-label="Filter capabilities">
          {capabilityCategories.map((category) => (
            <button key={category.id} type="button" aria-pressed={filter === category.id} onClick={() => setFilter(category.id)}>{category.label}</button>
          ))}
        </div>
        <p className="atlas-count" aria-live="polite"><b>{visibleCapabilities.length}</b> of {capabilities.length} capabilities</p>
      </div>

      {visibleCapabilities.length > 0 ? (
        <div className="atlas-grid">
          {visibleCapabilities.map((capability, index) => (
            <article className="atlas-card" id={capability.id} key={capability.id}>
              <div className="atlas-card-meta"><span>{String(index + 1).padStart(2, "0")} · {capability.surface}</span><i data-status={capability.status}>{capability.status}</i></div>
              <h3>{capability.title}</h3>
              <p>{capability.summary}</p>
              <details>
                <summary><span>Open full detail</span><ChevronDown size={16} aria-hidden="true" /></summary>
                <div className="atlas-detail">
                  <section><b>Player experience</b><p>{capability.playerExperience}</p></section>
                  <section><b>How it works</b><p>{capability.howItWorks}</p></section>
                  <section className="atlas-boundary"><b><ShieldCheck size={13} aria-hidden="true" /> Product boundary</b><p>{capability.boundary}</p></section>
                  <ul>{capability.proofPoints.map((point) => <li key={point}>{point}</li>)}</ul>
                  {capability.docsUrl && <a href={capability.docsUrl} target="_blank" rel="noreferrer">{capability.docsLabel ?? "Read the implementation"}<ArrowUpRight size={14} /></a>}
                </div>
              </details>
            </article>
          ))}
        </div>
      ) : (
        <div className="atlas-empty"><Search size={20} /><h3>No capability matches that search.</h3><p>Try a broader term or select Everything.</p><button type="button" onClick={() => { setQuery(""); setFilter("all"); }}>Clear filters</button></div>
      )}
    </section>
  );
}

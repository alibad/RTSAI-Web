/**
 * Picture choices for the Attack demo: what a weapon fires (a tracer, a shell's arc, a missile, a bolt...) and the
 * training target it fires at. Small pixel-style glyphs in currentColor, 20x16, crisp at 1x and 2x.
 */
import type { DummyKind, WeaponEffect } from "../../../../lib/weapon-demo";

const svg = (children: React.ReactNode) => <svg width="20" height="16" viewBox="0 0 20 16" fill="none" aria-hidden="true" shapeRendering="crispEdges">{children}</svg>;

export function EffectGlyph({ effect }: { effect: WeaponEffect }) {
  switch (effect) {
    case "tracer": case "bullet": return svg(<><rect x="1" y="7" width="3" height="2" fill="currentColor" opacity=".5" /><rect x="6" y="7" width="3" height="2" fill="currentColor" opacity=".75" /><rect x="11" y="7" width="7" height="2" fill="currentColor" /></>);
    case "shell": return svg(<><path d="M2 12 Q 9 4 17 9" stroke="currentColor" strokeWidth="1" strokeDasharray="2 2" opacity=".6" /><rect x="15" y="7" width="3" height="3" fill="currentColor" /></>);
    case "artillery": case "lob": return svg(<><path d="M2 14 Q 8 -2 16 12" stroke="currentColor" strokeWidth="1" strokeDasharray="2 2" opacity=".6" /><rect x="14" y="10" width="3" height="3" fill="currentColor" /></>);
    case "flak": return svg(<><rect x="9" y="2" width="2" height="12" fill="currentColor" opacity=".35" /><rect x="5" y="6" width="10" height="4" fill="currentColor" opacity=".55" /><rect x="7" y="4" width="6" height="8" fill="currentColor" opacity=".8" /><rect x="9" y="6" width="2" height="4" fill="currentColor" /></>);
    case "missile": return svg(<><rect x="1" y="9" width="2" height="2" fill="currentColor" opacity=".3" /><rect x="4" y="8" width="3" height="3" fill="currentColor" opacity=".5" /><rect x="8" y="7" width="8" height="3" fill="currentColor" /><rect x="16" y="8" width="2" height="1" fill="currentColor" /><rect x="9" y="5" width="2" height="2" fill="currentColor" /><rect x="9" y="10" width="2" height="2" fill="currentColor" /></>);
    case "torpedo": return svg(<><rect x="6" y="9" width="10" height="2" fill="currentColor" /><rect x="2" y="7" width="1" height="1" fill="currentColor" /><rect x="4" y="5" width="1" height="1" fill="currentColor" /><path d="M0 13 H20" stroke="currentColor" strokeWidth="1" opacity=".4" /></>);
    case "bomb": return svg(<><rect x="8" y="2" width="4" height="8" fill="currentColor" /><rect x="7" y="1" width="6" height="2" fill="currentColor" opacity=".6" /><rect x="9" y="11" width="2" height="2" fill="currentColor" opacity=".5" /><rect x="9" y="14" width="2" height="1" fill="currentColor" opacity=".3" /></>);
    case "laser": case "beam": return svg(<><rect x="1" y="7" width="17" height={effect === "beam" ? 3 : 2} fill="currentColor" /><rect x="1" y="5" width="17" height="1" fill="currentColor" opacity=".3" /><rect x="1" y="11" width="17" height="1" fill="currentColor" opacity=".3" /></>);
    case "tesla": return svg(<path d="M1 8 L5 4 L8 10 L12 3 L14 11 L18 6" stroke="currentColor" strokeWidth="2" strokeLinejoin="miter" />);
    case "rad": return svg(<path d="M1 8 Q 3.5 3 6 8 T 11 8 T 16 8 T 19 8" stroke="currentColor" strokeWidth="2" />);
    case "bite": return svg(<><path d="M3 4 L6 9 L9 4 L12 9 L15 4" stroke="currentColor" strokeWidth="2" /><path d="M3 13 L6 9 L9 13 L12 9 L15 13" stroke="currentColor" strokeWidth="2" opacity=".6" /></>);
  }
}

export function TargetGlyph({ kind }: { kind: DummyKind }) {
  switch (kind) {
    case "infantry": return svg(<><rect x="8" y="1" width="4" height="4" fill="currentColor" /><rect x="6" y="5" width="8" height="6" fill="currentColor" /><rect x="9" y="11" width="2" height="4" fill="currentColor" opacity=".7" /></>);
    case "vehicle": return svg(<><rect x="2" y="8" width="16" height="5" fill="currentColor" /><rect x="6" y="5" width="7" height="3" fill="currentColor" /><rect x="13" y="6" width="6" height="1" fill="currentColor" /><rect x="3" y="13" width="14" height="2" fill="currentColor" opacity=".55" /></>);
    case "building": return svg(<><path d="M2 6 L10 2 L18 6 V13 L10 15 L2 13 Z" fill="currentColor" opacity=".85" /><rect x="11" y="8" width="5" height="2" fill="#141914" /></>);
    case "aircraft": return svg(<><rect x="2" y="7" width="16" height="2" fill="currentColor" /><path d="M8 7 L11 2 L13 2 L12 7 Z M8 9 L11 14 L13 14 L12 9 Z" fill="currentColor" /><rect x="2" y="5" width="2" height="2" fill="currentColor" /></>);
    case "ship": return svg(<><path d="M1 9 H19 L16 13 H4 Z" fill="currentColor" /><rect x="7" y="5" width="6" height="4" fill="currentColor" opacity=".8" /><rect x="9" y="2" width="1" height="3" fill="currentColor" /></>);
    case "sub": return svg(<><rect x="2" y="9" width="16" height="3" fill="currentColor" /><rect x="8" y="5" width="4" height="4" fill="currentColor" /><path d="M0 12 H20" stroke="currentColor" strokeWidth="1" opacity=".4" /></>);
  }
}

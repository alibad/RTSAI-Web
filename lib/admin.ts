/**
 * Admin surfaces (Campaign studio, AI testing, the AI Arena, the Studio's tools) are the owner's. Two ways in:
 * - The local app (scripts/local-app.ps1) is an admin build (`RTSAI_ADMIN=1 npm run build`), only ever served on
 *   this machine: the build itself is the gate, and everything works with no sign-in.
 * - On rtsai.net (a public build), the owner signs in with an owner email (OWNER_EMAILS). The admin there shows what
 *   works without this machine and names what each local-only tool needs. Their code stays out of public bundles:
 *   vite.config.ts swaps it for empty stubs.
 * Vite's `define` replaces process.env.RTSAI_ADMIN at build time, so ADMIN_BUILD is a constant in every bundle.
 */
export const ADMIN_BUILD = process.env.RTSAI_ADMIN === "1" || process.env.NODE_ENV !== "production";

/** The owner's sign-in emails: a verified one of these opens the admin on rtsai.net. */
export const OWNER_EMAILS = ["alibadereddin@gmail.com"];
export const isOwnerEmail = (email: string | null | undefined, verified: boolean) =>
  verified && !!email && OWNER_EMAILS.includes(email.trim().toLowerCase());

/** True in the local app: an admin build opened on this machine. Call it in the browser only. */
export const onThisMachine = () => ADMIN_BUILD && typeof window !== "undefined" && ["127.0.0.1", "localhost", "[::1]"].includes(window.location.hostname);

/** The local app, where the tools that need this machine run. */
export const LOCAL_APP = "http://127.0.0.1:3450";

export type AdminSurfaceId = "campaigns" | "arena" | "evals" | "content" | "review" | "forge" | "art";
export type AdminSurface = {
  id: AdminSurfaceId; title: string; href: string; about: string;
  /** What it needs on this machine; null when it works on rtsai.net too. */
  needs: { what: string; detail: string } | null;
  /** Served by the local Studio itself (LOCAL_APP), not by the website behind it. */
  studio?: boolean;
};

/** Every admin surface, what it needs, and so where it works (the /admin hub and each surface's own page). */
export const ADMIN_SURFACES: AdminSurface[] = [
  { id: "campaigns", title: "Campaign studio", href: "/workshop/campaigns?mode=ra2", needs: null,
    about: "Stories, characters, missions and briefings. Drafts stay in the browser you write them in." },
  { id: "arena", title: "AI Arena", href: "/workshop/arena?mode=ra2",
    about: "Brains play the live game against the AIs; the experiment notebook and its films.",
    needs: { what: "The AI Arena runner", detail: "RTSAI-WebGame tools/arena on port 3463: it plays the games, keeps their records and films, and holds the model keys." } },
  { id: "evals", title: "AI testing", href: "/workshop/evals?mode=ra2",
    about: "Headless OpenRA behaviour experiments.",
    needs: { what: "The native game runner", detail: "Port 3462: it runs the desktop engine headless." } },
  { id: "content", title: "Shared content", href: "/studio/content", studio: true,
    about: "Edit shared faction content in the mod's catalog.",
    needs: { what: "The local Studio", detail: "It writes RTSAI-Mod on this machine; nothing is saved online." } },
  { id: "review", title: "Art review", href: "/art/review", studio: true,
    about: "Review, compare and rebuild unit art and sounds.",
    needs: { what: "The local art workspace", detail: "RTSAI-Art on this machine: source models, renders and sounds." } },
  { id: "forge", title: "Concept Forge", href: "/art/forge", studio: true,
    about: "Exploratory soldiers, vehicles and defences with their full behaviour and sounds; route them to factions.",
    needs: { what: "The local Studio", detail: "RTSAI-Art tools/forge drafts in D:\Generated\RTSAI\art\concept-forge on this machine." } },
  { id: "art", title: "Art lab", href: "/art",
    about: "Every faction's art with its provenance.",
    needs: { what: "The local app, for now", detail: "Its pages carry provenance details the website doesn't serve privately yet." } },
];
export const adminSurface = (id: AdminSurfaceId) => ADMIN_SURFACES.find((s) => s.id === id)!;

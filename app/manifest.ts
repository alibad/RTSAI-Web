import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "RTS AI Website",
    short_name: "RTS AI Website",
    description: "Seven real-world factions, one fictional war, and an AI co-commander. Play in your browser or download the Windows alpha.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#151719",
    theme_color: "#151719",
    orientation: "any",
    icons: [
      { src: "/icon-192.png?v=command-red-2531", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png?v=command-red-2531", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png?v=command-red-2531", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

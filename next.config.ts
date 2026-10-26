import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pages with generateMetadata (factions, units, viewer) stream their title, description and canonical into a hidden
  // <div> in <body> for any user agent not on the HTML-limited bot list, and Googlebot is not on it. Google honours
  // rel=canonical only in <head>, so it saw those pages without one. Matching every user agent keeps metadata in <head>.
  htmlLimitedBots: /.*/,
  async redirects() {
    return [
      // www.rtsai.net serves the same site: send its pages to the canonical host. Vercel answers /play/ (the game proxy)
      // and static files before this code runs, so a game opened on www keeps its own API calls and sign-in there:
      // /api and /signin stay on both hosts (a cross-host redirect here drops the query, and with it ?next=).
      { source: "/:path((?!(?:api|signin)(?:/|$)).*)", has: [{ type: "host", value: "www.rtsai.net" }], destination: "https://rtsai.net/:path", permanent: true },
      // Crawlers read the route ids ("/download/page") in the inline page data and request them as URLs.
      { source: "/page", destination: "/", permanent: true },
      { source: "/:path(.+)/page", destination: "/:path", permanent: true },
    ];
  },
};

export default nextConfig;

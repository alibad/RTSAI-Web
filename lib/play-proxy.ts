/**
 * A plain byte pipe to another local server (the browser game under /play): method, path, Range and If-None-Match go
 * through as sent; the status (206, 304), every response header (COOP/COEP/CORP for cross-origin isolation, ETag,
 * Cache-Control, Content-Encoding: br, Accept-Ranges, Content-Range) and the body stream back untouched. Nothing is
 * buffered, decoded or recompressed.
 */
import { request, type IncomingMessage, type ServerResponse } from "node:http";

export const isPlayPath = (url: string | undefined) => url === "/play" || Boolean(url?.startsWith("/play/") || url?.startsWith("/play?"));

export function proxyTo(origin: URL, unavailable: string) {
  return (req: IncomingMessage, res: ServerResponse) => {
    const upstream = request({ hostname: origin.hostname, port: origin.port, method: req.method, path: req.url, headers: { ...req.headers, host: origin.host } }, up => {
      res.writeHead(up.statusCode ?? 502, up.statusMessage, up.rawHeaders);
      up.pipe(res);
    });
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(unavailable);
    });
    res.on("close", () => { if (!res.writableFinished) upstream.destroy(); });
    req.pipe(upstream);
  };
}

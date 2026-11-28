// A switchable proxy in front of the app for the offline e2e tests. While "offline" it drops every
// connection, so the browser and its service worker really can't reach the server (Playwright's
// setOffline doesn't apply to a service worker's own requests). POST /__proxy/offline|online switches.
import { createServer, request } from "node:http";

const port = Number(process.env.MOCK_PROXY_PORT ?? 3103);
const target = Number(process.env.MOCK_PROXY_TARGET ?? 3100);
let offline = false;

createServer((req, res) => {
  if (req.url === "/__proxy/health") return res.end("ok");
  if (req.method === "POST" && (req.url === "/__proxy/offline" || req.url === "/__proxy/online")) {
    offline = req.url === "/__proxy/offline";
    return res.end(offline ? "offline" : "online");
  }
  if (offline) return req.socket.destroy();
  const up = request({ host: "localhost", port: target, method: req.method, path: req.url, headers: req.headers }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers);
    r.pipe(res);
  });
  up.on("error", () => res.headersSent ? res.destroy() : res.writeHead(502).end());
  req.pipe(up);
}).listen(port);

// A stand-in for the WhatsApp Cloud API and the Resend email API during e2e tests.
// Records every message; GET /sent lists them so a test can check what went out.
import { createServer } from "node:http";

const port = Number(process.env.MOCK_MESSAGING_PORT ?? 3102);
const sent = [];
let n = 0;

createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  const json = (status, body) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (url.pathname === "/health") return res.end("ok");
  if (req.method === "GET" && url.pathname === "/sent") return json(200, sent);
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    let body = null;
    try {
      body = JSON.parse(raw);
    } catch {
      return json(400, { error: { message: "Invalid JSON", code: 100 } });
    }
    const auth = req.headers.authorization ?? "";
    if (req.method === "POST" && /\/[^/]+\/messages$/.test(url.pathname)) {
      if (auth !== "Bearer test-whatsapp-token") return json(401, { error: { message: "Invalid OAuth access token", code: 190 } });
      const id = `wamid.test${++n}`;
      sent.push({ channel: "whatsapp", id, path: url.pathname, to: body.to, type: body.type, text: body.text?.body ?? null, template: body.template ?? null });
      return json(200, { messaging_product: "whatsapp", contacts: [{ input: body.to, wa_id: body.to }], messages: [{ id }] });
    }
    if (req.method === "POST" && url.pathname === "/emails") {
      if (auth !== "Bearer test-resend-key") return json(401, { message: "API key is invalid" });
      const id = `email-${++n}`;
      sent.push({ channel: "email", id, to: body.to?.[0], subject: body.subject, text: body.text });
      return json(200, { id });
    }
    json(404, { error: { message: "Not found" } });
  });
}).listen(port);

// A stand-in for the Open-Meteo API during e2e tests (no outside network needed).
// Answers /v1/forecast and /v1/archive with fixed partly-cloudy weather for the requested day.
import { createServer } from "node:http";

const port = Number(process.env.MOCK_OPEN_METEO_PORT ?? 3101);
createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  if (url.pathname === "/health") return res.end("ok");
  if (url.pathname !== "/v1/forecast" && url.pathname !== "/v1/archive") {
    res.writeHead(404).end();
    return;
  }
  const day = url.searchParams.get("start_date");
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      latitude: Number(url.searchParams.get("latitude")),
      longitude: Number(url.searchParams.get("longitude")),
      daily: { time: [day], weather_code: [2], temperature_2m_max: [29.6], temperature_2m_min: [18.2], precipitation_sum: [0.4], wind_speed_10m_max: [14.3] },
    }),
  );
}).listen(port);

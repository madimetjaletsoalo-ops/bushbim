import { defineConfig } from "@playwright/test";

const PORT = 3100;
const WEATHER_PORT = 3101;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "off",
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  webServer: [
    {
      // stand-in for the Open-Meteo weather API used by Daily Logs
      command: `node tests/e2e/mock-open-meteo.mjs`,
      url: `http://localhost:${WEATHER_PORT}/health`,
      env: { MOCK_OPEN_METEO_PORT: String(WEATHER_PORT) },
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `npx next start -p ${PORT}`,
      port: PORT,
      env: { OPEN_METEO_URL: `http://localhost:${WEATHER_PORT}` },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});

import { defineConfig } from "@playwright/test";

const PORT = 3100;
const WEATHER_PORT = 3101;
const MESSAGING_PORT = 3102;
const OFFLINE_PROXY_PORT = 3103;

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
      // stand-in for the WhatsApp Cloud API and the email API used by notifications
      command: `node tests/e2e/mock-messaging.mjs`,
      url: `http://localhost:${MESSAGING_PORT}/health`,
      env: { MOCK_MESSAGING_PORT: String(MESSAGING_PORT) },
      reuseExistingServer: !process.env.CI,
    },
    {
      // switchable proxy in front of the app, for the offline tests
      command: `node tests/e2e/mock-offline-proxy.mjs`,
      url: `http://localhost:${OFFLINE_PROXY_PORT}/__proxy/health`,
      env: { MOCK_PROXY_PORT: String(OFFLINE_PROXY_PORT), MOCK_PROXY_TARGET: String(PORT) },
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `npx next start -p ${PORT}`,
      port: PORT,
      env: {
        OPEN_METEO_URL: `http://localhost:${WEATHER_PORT}`,
        WHATSAPP_API_URL: `http://localhost:${MESSAGING_PORT}/v21.0`,
        WHATSAPP_TOKEN: "test-whatsapp-token",
        WHATSAPP_PHONE_NUMBER_ID: "1234567890",
        WHATSAPP_TEMPLATE: "bushbim_notification",
        WHATSAPP_APP_SECRET: "test-whatsapp-app-secret",
        WHATSAPP_VERIFY_TOKEN: "test-verify-token",
        RESEND_API_URL: `http://localhost:${MESSAGING_PORT}`,
        RESEND_API_KEY: "test-resend-key",
        EMAIL_FROM: "BushBIM <noreply@bushbim.test>",
      },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});

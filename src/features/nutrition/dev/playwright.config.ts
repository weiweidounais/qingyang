import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: {
    channel: "chrome",
    baseURL: "http://127.0.0.1:3001",
    viewport: { width: 390, height: 844 },
  },
  reporter: "list",
  outputDir: "../../../../.local/m03-e2e-results",
});

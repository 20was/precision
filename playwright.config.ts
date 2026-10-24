import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests",
  testMatch: "**/*.spec.ts",
  workers: 1,
  timeout: 90000,
  reporter: [["list"], ["json", { outputFile: "test-results/results.json" }]],
  webServer: {
    command: "python3 -m http.server 4173 --directory tests/fixtures",
    url: "http://localhost:4173",
    reuseExistingServer: true,
  },
  projects: [{ name: "chromium" }, { name: "chrome" }, { name: "brave" }],
});

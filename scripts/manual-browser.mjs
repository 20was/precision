import { chromium } from "@playwright/test";
const context = await chromium.launchPersistentContext("", {
  channel: "chromium",
  headless: false,
  ignoreDefaultArgs: ["--disable-extensions"],
  viewport: null,
  args: ["--enable-unsafe-extension-debugging", "--remote-debugging-port=9333"],
});
const cdp = await context.browser().newBrowserCDPSession();
const { id } = await cdp.send("Extensions.loadUnpacked", {
  path: process.cwd() + "/dist",
});
const page = context.pages()[0];
await page.goto("http://localhost:4173");
context.on("console", (m) => console.log("BROWSER", m.text()));
console.log("READY", id);
try {
  const preview = await context.waitForEvent("page", { timeout: 180000 });
  await preview.waitForSelector("#capture:not([hidden])", { timeout: 20000 });
  await preview.screenshot({ path: "docs/manual-preview.png" });
  console.log("PREVIEW", await preview.locator("#dimensions").textContent());
} catch (e) {
  console.log(e.message);
}
await page.waitForTimeout(60000);
await context.close();

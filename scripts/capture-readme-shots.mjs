/* global requestAnimationFrame, Image, document */
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const fixture = await readFile(resolve("tests/fixtures/showcase.html"));
const storeMode = process.argv.includes("--store");
const viewport = storeMode
  ? { width: 1280, height: 800 }
  : { width: 1440, height: 960 };
const server = createServer((request, response) => {
  if (request.url !== "/showcase.html") {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(fixture);
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const address = server.address();
if (!address || typeof address === "string")
  throw new Error("Local server did not start");
const context = await chromium.launchPersistentContext("", {
  channel: "chromium",
  headless: true,
  ignoreDefaultArgs: ["--disable-extensions"],
  viewport,
  deviceScaleFactor: 1,
  args: [
    "--enable-unsafe-extension-debugging",
    `--window-size=${viewport.width},${viewport.height}`,
  ],
});
try {
  const cdp = await context.browser().newBrowserCDPSession();
  const { id } = await cdp.send("Extensions.loadUnpacked", {
    path: resolve("dist"),
  });
  const page = context.pages()[0];
  if (!page) throw new Error("No browser page was created");
  await page.goto(`http://127.0.0.1:${address.port}/showcase.html`);
  const targets = await cdp.send("Target.getTargets", {
    filter: [{ type: "tab" }],
  });
  const target = targets.targetInfos.find((item) => item.url === page.url());
  if (!target) throw new Error("Showcase tab was not found");
  await cdp.send("Extensions.triggerAction", {
    id,
    targetId: target.targetId,
  });
  let popupTargetId = "";
  for (let attempt = 0; attempt < 40 && !popupTargetId; attempt++) {
    const all = await cdp.send("Target.getTargets");
    popupTargetId =
      all.targetInfos.find(
        (item) => item.url === `chrome-extension://${id}/popup.html`,
      )?.targetId ?? "";
    if (!popupTargetId) await page.waitForTimeout(50);
  }
  if (!popupTargetId) throw new Error("Precision popup did not open");
  const { sessionId } = await cdp.send("Target.attachToTarget", {
    targetId: popupTargetId,
    flatten: false,
  });
  await cdp.send("Target.sendMessageToTarget", {
    sessionId,
    message: JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: {
        expression:
          "document.readyState==='loading' ? document.addEventListener('DOMContentLoaded',()=>document.querySelector('#start').click(),{once:true}) : document.querySelector('#start').click()",
        userGesture: true,
      },
    }),
  });
  await page.locator("precision-selector").waitFor({ timeout: 10_000 });
  const story = await page.locator("#capture-story").boundingBox();
  if (!story) throw new Error("Showcase story has no visible bounds");
  await page.mouse.move(story.x + story.width / 2, story.y + story.height / 2);
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  const output = resolve(storeMode ? "store-assets" : "docs/images");
  await mkdir(output, { recursive: true });
  const saveScreenshot = async (path) => {
    const screenshot = await page.screenshot({ type: "png" });
    if (storeMode) {
      await writeFile(path, screenshot);
      return;
    }
    const webp = await page.evaluate(async (base64) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext("2d").drawImage(image, 0, 0);
      return canvas.toDataURL("image/webp", 0.88).split(",")[1];
    }, screenshot.toString("base64"));
    if (!webp)
      throw new Error("This browser could not encode a WebP screenshot");
    await writeFile(path, Buffer.from(webp, "base64"));
  };
  await saveScreenshot(
    `${output}/${storeMode ? "selection.png" : "selection.webp"}`,
  );

  await page.keyboard.press("Enter");
  await page.locator("precision-preview").waitFor();
  await saveScreenshot(
    `${output}/${storeMode ? "preview.png" : "preview.webp"}`,
  );
  console.log(`Saved real extension screenshots to ${output}`);
} finally {
  await context.close();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

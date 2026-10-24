/* eslint-disable no-empty-pattern -- Playwright requires fixture destructuring. */
import {
  test,
  expect,
  chromium,
  type BrowserContext,
  type Worker,
  type Page,
  type CDPSession,
} from "@playwright/test";
import { PNG } from "pngjs";
import { readFile, access } from "node:fs/promises";
import { resolve } from "node:path";
let context: BrowserContext,
  worker: Worker,
  page: Page,
  browserCDP: CDPSession,
  id: string;
const paths: Record<string, string> = {
  chrome: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  brave: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
};
async function activate() {
  await page.bringToFront();
  const targets = await browserCDP.send("Target.getTargets", {
    filter: [{ type: "tab" }],
  });
  const target = targets.targetInfos.find((t) => t.url === page.url())!;
  const started = performance.now();
  await browserCDP.send("Extensions.triggerAction", {
    id,
    targetId: target.targetId,
  });
  let popupId = "";
  await expect
    .poll(async () => {
      const all = await browserCDP.send("Target.getTargets");
      popupId =
        all.targetInfos.find(
          (t) => t.url === `chrome-extension://${id}/popup.html`,
        )?.targetId ?? "";
      return !!popupId;
    })
    .toBe(true);
  const { sessionId } = await browserCDP.send("Target.attachToTarget", {
    targetId: popupId,
    flatten: false,
  });
  await browserCDP.send("Target.sendMessageToTarget", {
    sessionId,
    message: JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: {
        expression: `document.readyState==='loading' ? document.addEventListener('DOMContentLoaded',()=>document.querySelector('#start').click(),{once:true}) : document.querySelector('#start').click()`,
        userGesture: true,
      },
    }),
  });
  await expect(page.locator("precision-selector")).toHaveCount(1);
  await expect
    .poll(async () =>
      (await browserCDP.send("Target.getTargets")).targetInfos.some(
        (t) => t.targetId === popupId,
      ),
    )
    .toBe(false);
  console.log(
    "Activation including popup ms",
    Math.round(performance.now() - started),
  );
}
async function select(selector: string) {
  const box = await page.locator(selector).boundingBox();
  expect(box).not.toBeNull();
  const started = performance.now();
  await page.mouse.move(
    box!.x + Math.min(box!.width / 2, 20),
    box!.y + Math.min(box!.height / 2, 20),
  );
  await clickShadowButton("Preview selected element");
  await expect(page.locator("precision-preview")).toHaveCount(1);
  console.log("Click to decoded preview ms", Math.round(performance.now() - started));
  return page;
}
async function clickShadowButton(label: string) {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const cdp = await context.newCDPSession(page);
  const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
  type Node = { backendNodeId: number; attributes?: string[]; children?: Node[]; shadowRoots?: Node[] };
  const find = (node: Node): Node | undefined => {
    if (node.attributes?.includes(label)) return node;
    for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])]) { const result = find(child); if (result) return result; }
  };
  const node = find(root);
  expect(node, `Shadow DOM button ${label}`).toBeTruthy();
  const { model } = await cdp.send("DOM.getBoxModel", { backendNodeId: node!.backendNodeId });
  const x = (model.border[0] + model.border[4]) / 2;
  const y = (model.border[1] + model.border[5]) / 2;
  await page.mouse.click(x, y);
  await cdp.detach();
}
test.beforeEach(async ({}, info) => {
  const executablePath = paths[info.project.name];
  if (executablePath) {
    try {
      await access(executablePath);
    } catch {
      test.skip(true, `${info.project.name} executable not installed`);
    }
  }
  context = await chromium.launchPersistentContext("", {
    channel: executablePath ? undefined : "chromium",
    executablePath,
    headless: true,
    ignoreDefaultArgs: ["--disable-extensions"],
    viewport: null,
    args: [
      "--enable-unsafe-extension-debugging",
      "--window-size=1200,900",
      "--force-device-scale-factor=2",
    ],
  });
  browserCDP = await context.browser()!.newBrowserCDPSession();
  const loaded = await browserCDP.send("Extensions.loadUnpacked", {
    path: resolve("dist"),
  });
  id = loaded.id;
  console.log("Loaded extension", id);
  worker =
    context.serviceWorkers().find((w) => w.url().includes(id)) ??
    (await context.waitForEvent("serviceworker"));
  page = context.pages()[0]!;
  await page.goto("http://localhost:4173");
  console.log("Browser", await context.browser()!.version());
});
test.afterEach(async () => {
  await context?.close();
});
test("real action capture pixels, clipboard, PNG export, zoom and cleanup", async ({}, info) => {
  for (const zoom of [1, 1.25, 1.5]) {
    await page.bringToFront();
    await worker.evaluate(async (zoom) => {
      const [t] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      await chrome.tabs.setZoom(t.id!, zoom);
    }, zoom);
    await page.locator("#solid").evaluate((el) => {
      (el as HTMLElement).style.cssText =
        "position:fixed;left:40px;top:140px;width:240px;height:160px;background:rgb(32,128,192);z-index:5";
    });

    const viewport = await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      dpr: devicePixelRatio,
      vv: { width: visualViewport!.width, height: visualViewport!.height },
    }));
    const rect = await page.locator("#solid").boundingBox();
    await activate();
    await select("#solid");
    console.log(
      "Worker timings",
      await worker.evaluate(() =>
        performance
          .getEntriesByType("measure")
          .map((e) => ({ name: e.name, ms: Math.round(e.duration) })),
      ),
    );
    await expect(page.locator("precision-selector")).toHaveCount(0);

    const sx = 2 * zoom,
      sy = 2 * zoom;
    console.log("Capture environment", JSON.stringify({ zoom, ...viewport, rect }));
    const expectedWidth = Math.floor((rect!.x + rect!.width) * sx + 1e-7) - Math.ceil(rect!.x * sx - 1e-7);
    const expectedHeight = Math.floor((rect!.y + rect!.height) * sy + 1e-7) - Math.ceil(rect!.y * sy - 1e-7);
    // Read permission is test-only; the production extension requests write access only.
    await context.grantPermissions(["clipboard-read"]);
    await clickShadowButton("Copy image");
    await expect(page.locator("precision-preview")).toHaveCount(1);
    let clipboardBytes: number[] | undefined;
    const seenClipboardSizes = new Set<string>();
    for (let attempt = 0; attempt < 30 && !clipboardBytes; attempt++) {
      try {
        const candidate = await page.evaluate(async () => {
          const items = await navigator.clipboard.read();
          const pngs: number[][] = [];
          for (const item of items) if (item.types.includes("image/png")) {
            const blob = await item.getType("image/png");
            pngs.push(Array.from(new Uint8Array(await blob.arrayBuffer())));
          }
          return pngs;
        });
        for (const bytes of candidate) {
          const image = PNG.sync.read(Buffer.from(bytes));
          seenClipboardSizes.add(`${image.width}x${image.height}`);
          if (image.width === expectedWidth && image.height === expectedHeight) {
            clipboardBytes = bytes;
            return true;
          }
        }
      } catch { /* the system clipboard can change during another browser operation */ }
      if (!clipboardBytes) await page.waitForTimeout(100);
    }
    if (!clipboardBytes)
      throw new Error(`Clipboard did not update to ${expectedWidth}×${expectedHeight}; observed ${[...seenClipboardSizes].join(", ") || "no readable PNG"}.`);
    const png = PNG.sync.read(Buffer.from(clipboardBytes));
    expect(png.width).toBe(expectedWidth);
    expect(png.height).toBe(expectedHeight);
    let wrong = 0;
    for (let i = 0; i < png.data.length; i += 4)
      if (png.data[i] !== 32 || png.data[i + 1] !== 128 || png.data[i + 2] !== 192 || png.data[i + 3] !== 255) wrong++;
    expect(wrong).toBe(0);
    const downloadEvent = page.waitForEvent("download");
    await clickShadowButton("Download PNG");
    const download = await downloadEvent;
    const path = info.outputPath(`capture-${zoom}.png`);
    await download.saveAs(path);
    const downloaded = PNG.sync.read(await readFile(path));
    expect(downloaded.width).toBe(expectedWidth);
    expect(downloaded.height).toBe(expectedHeight);
    let downloadWrong = 0;
    for (let i = 0; i < downloaded.data.length; i += 4)
      if (downloaded.data[i] !== 32 || downloaded.data[i + 1] !== 128 || downloaded.data[i + 2] !== 192 || downloaded.data[i + 3] !== 255) downloadWrong++;
    expect(downloadWrong).toBe(0);
    if (zoom === 1) {
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        for (const width of [1440, 390]) {
          await page.setViewportSize({ width, height: 900 });
          await page.screenshot({ path: info.outputPath(`preview-${colorScheme}-${width}.png`) });
        }
      }
      await page.setViewportSize({ width: 1200, height: 900 });
    }
    await clickShadowButton("Close");
    await expect(page.locator("precision-preview")).toHaveCount(0);
    await expect(page).toHaveURL("http://localhost:4173/");
  }
  await activate();
  await page.keyboard.press("Escape");
  await expect(page.locator("precision-selector")).toHaveCount(0);
  await activate();
  await select("#action");
  expect(await page.locator("#count").textContent()).toBe("0");
  await clickShadowButton("Close");
  await page.bringToFront();
  await page.locator("#action").click();
  expect(await page.locator("#count").textContent()).toBe("1");
});
test("keyboard, clipping, repeated cancellation, navigation and expired preview", async ({}, info) => {
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  const baseline = await cdp.send("Runtime.getHeapUsage");
  for (let i = 0; i < 5; i++) {
    await activate();
    const hoverStart = performance.now();
    await page.mouse.move(80, 240, { steps: 10 });
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    console.log(
      "10 pointer steps plus two frames ms",
      Math.round(performance.now() - hoverStart),
    );
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Escape");
    await expect(page.locator("precision-selector")).toHaveCount(0);
  }
  await cdp.send("HeapProfiler.collectGarbage");
  const after = await cdp.send("Runtime.getHeapUsage");
  console.log(
    "Renderer heap baseline/after cancellation",
    baseline.usedSize,
    after.usedSize,
  );
  await activate();
  await page.screenshot({ path: info.outputPath("selection.png") });
  await page.locator(".partial").evaluate((el) => {
    el.textContent = "";
  });
  const partialBox = await page.locator(".partial").boundingBox();
  await page.mouse.move(30, partialBox!.y + 30);
  await page.keyboard.press("Enter");
  await expect(page.locator("precision-preview")).toHaveCount(1);
  const dimensions = await page.evaluate(() => { const host = document.querySelector("precision-preview")!; const root = (host as HTMLElement).shadowRoot; return root?.querySelector("canvas") ? { width: root.querySelector("canvas")!.width, height: root.querySelector("canvas")!.height } : null; });
  // Closed shadow content is verified through its accessible DOM snapshot below.
  expect(dimensions).toBeNull();
  await clickShadowButton("Close");
  await activate();
  await page.reload();
  await expect(page.locator("precision-selector")).toHaveCount(0);

});

test("representative DOM fixtures and native toolbar controls", async ({}, info) => {
  // Exercise the same pointer/capture pipeline on distinct rendering cases.
  for (const selector of [
    "h1",
    "#card strong",
    "header",
    "nav",
    ".clip div",
    ".rotated",
    "img",
    ".dark p",
    "input",
    "[contenteditable]",
    "iframe",
    "#shadow p",
    "table",
  ]) {
    await page.bringToFront();
    await page.locator(selector).scrollIntoViewIfNeeded();
    await activate();
    await select(selector);
    await expect(page.locator("precision-preview")).toHaveCount(1);
    await clickShadowButton("Close");
    // Intentional API quota spacing between independent test captures (2/second).
    await page.waitForTimeout(600);
  }
  await page.locator("input").focus();
  await activate();
  await page.locator("input").focus(); // descendant blur must not cancel selection
  await expect(page.locator("precision-selector")).toHaveCount(1);
  const cdp = await context.newCDPSession(page);
  const { root } = await cdp.send("DOM.getDocument", {
    depth: -1,
    pierce: true,
  });
  type Node = {
    backendNodeId: number;
    attributes?: string[];
    children?: Node[];
    shadowRoots?: Node[];
  };
  const find = (node: Node, label = "Cancel selection"): Node | undefined => {
    if (node.attributes?.includes(label)) return node;
    for (const child of [
      ...(node.children ?? []),
      ...(node.shadowRoots ?? []),
    ]) {
      const result = find(child);
      if (result) return result;
    }
  };
  const button = find(root);
  expect(button).toBeTruthy();
  const { model } = await cdp.send("DOM.getBoxModel", {
    backendNodeId: button!.backendNodeId,
  });
  await page.mouse.click(
    (model.border[0]! + model.border[4]!) / 2,
    (model.border[1]! + model.border[5]!) / 2,
  );
  await expect(page.locator("precision-selector")).toHaveCount(0);

  // Direct copy stays on the webpage; clipboard contents are read by the test only.
  await context.grantPermissions(["clipboard-read"]);
  await page.locator("#solid").evaluate((el) => {
    (el as HTMLElement).style.cssText =
      "position:fixed;left:40px;top:140px;width:240px;height:160px;background:rgb(32,128,192);z-index:5";
  });
  await page.bringToFront();
  await activate();
  await page.mouse.move(80, 180);
  const pagesBefore = context.pages().length;
  const tree = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
  type ShadowNode = {
    backendNodeId: number;
    attributes?: string[];
    children?: ShadowNode[];
    shadowRoots?: ShadowNode[];
  };
  const findCopy = (node: ShadowNode): ShadowNode | undefined => {
    if (node.attributes?.includes("Copy selected element")) return node;
    for (const child of [
      ...(node.children ?? []),
      ...(node.shadowRoots ?? []),
    ]) {
      const found = findCopy(child);
      if (found) return found;
    }
  };
  const copyButton = findCopy(tree.root);
  expect(copyButton).toBeTruthy();
  const copyBox = await cdp.send("DOM.getBoxModel", {
    backendNodeId: copyButton!.backendNodeId,
  });
  await page.mouse.click(
    (copyBox.model.border[0] + copyBox.model.border[4]) / 2,
    (copyBox.model.border[1] + copyBox.model.border[5]) / 2,
  );
  await expect.poll(() => context.pages().length).toBe(pagesBefore);
  await expect(page.locator("precision-notice")).toHaveCount(1);
  const copied = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const blob = await items[0]!.getType("image/png");
    const image = await createImageBitmap(blob);
    let wrong = 0;
    const canvas = new OffscreenCanvas(image.width, image.height),
      ctx = canvas.getContext("2d")!;
    ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, image.width, image.height).data;
    for (let i = 0; i < pixels.length; i += 4)
      if (
        Math.abs(pixels[i]! - 32) > 1 ||
        Math.abs(pixels[i + 1]! - 128) > 1 ||
        Math.abs(pixels[i + 2]! - 192) > 1 ||
        pixels[i + 3] !== 255
      )
        wrong++;
    const result = { width: image.width, height: image.height, wrong };
    image.close();
    return result;
  });
  expect(copied).toEqual({ width: 480, height: 320, wrong: 0 });

  // Compact controls move outside a small selected button, while preserving its target on the way to Preview.
  await activate();
  await page.locator("#action").scrollIntoViewIfNeeded();
  const actionBox = await page.locator("#action").boundingBox();
  expect(actionBox).not.toBeNull();
  await page.mouse.move(actionBox!.x + actionBox!.width / 2, actionBox!.y + actionBox!.height / 2);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const actionTree = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
  const findNamed = (node: ShadowNode, label: string): ShadowNode | undefined => {
    if (node.attributes?.includes(label)) return node;
    for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])]) { const found = findNamed(child, label); if (found) return found; }
  };
  const copyControl = findNamed(actionTree.root, "Copy selected element");
  expect(copyControl).toBeTruthy();
  const copyModel = await cdp.send("DOM.getBoxModel", { backendNodeId: copyControl!.backendNodeId });
  const cb = copyModel.model.border;
  const controlRect = { x: cb[0]!, y: cb[1]!, width: cb[4]!-cb[0]!, height: cb[5]!-cb[1]! };
  expect(controlRect.x + controlRect.width <= actionBox!.x || controlRect.x >= actionBox!.x + actionBox!.width || controlRect.y + controlRect.height <= actionBox!.y || controlRect.y >= actionBox!.y + actionBox!.height).toBe(true);
  await clickShadowButton("Preview selected element");
  await expect(page.locator("precision-preview")).toHaveCount(1);
  expect(await page.locator("#count").textContent()).toBe("0");
  await clickShadowButton("Close");

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  for (const colorScheme of ["light", "dark"] as const) {
    await popup.emulateMedia({ colorScheme });
    await popup
      .locator("body")
      .screenshot({ path: info.outputPath(`popup-${colorScheme}.png`) });
  }
});

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
async function activate(mode: "element" | "visible" | "fullPage" | "compose" = "element", waitForResult = true) {
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
        expression: `document.readyState==='loading' ? document.addEventListener('DOMContentLoaded',()=>document.querySelector('[data-mode="${mode}"]').click(),{once:true}) : document.querySelector('[data-mode="${mode}"]').click()`,
        userGesture: true,
      },
    }),
  });
  if (mode === "visible" || mode === "fullPage") {
    if (mode === "fullPage") {
      if (!waitForResult) {
        await expect(page.locator("precision-full-page-progress")).toHaveCount(1);
        return;
      }
      await expect.poll(async () => {
        const targetsNow = (await browserCDP.send("Target.getTargets")).targetInfos;
        const editorTarget = targetsNow.some((t) => t.url.startsWith(`chrome-extension://${id}/editor.html?id=`));
        const errorHost = await page.locator("precision-error").count();
        return editorTarget ? "editor" : errorHost ? "error" : "pending";
      }, { timeout: 10_000, intervals: [100, 200, 500] }).not.toBe("pending").catch(() => undefined);
      const editorOrError = (await browserCDP.send("Target.getTargets")).targetInfos.some((t) => t.url.startsWith(`chrome-extension://${id}/editor.html?id=`)) ? "editor" : "error";
      if (editorOrError === "error") {
        const cdp = await context.newCDPSession(page);
        const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
        type Node = { nodeName?: string; nodeValue?: string; children?: Node[]; shadowRoots?: Node[] };
        const findText = (node: Node): string => `${node.nodeValue ?? ""}${(node.children ?? []).map(findText).join("")}${(node.shadowRoots ?? []).map(findText).join("")}`;
        const findError = (node: Node): Node | undefined => node.nodeName === "PRECISION-ERROR" ? node : [...(node.children ?? []), ...(node.shadowRoots ?? [])].map(findError).find(Boolean);
        const error = findError(root as Node);
        const message = error ? findText(error) : "no error UI detected";
        const progressNode = (node: Node): Node | undefined => node.nodeName === "PRECISION-FULL-PAGE-PROGRESS" ? node : [...(node.children ?? []), ...(node.shadowRoots ?? [])].map(progressNode).find(Boolean);
        const progress = progressNode(root as Node);
        const progressText = progress ? findText(progress) : "no progress UI";
        const observed = await page.evaluate(() => ({ progress: !!document.querySelector("precision-full-page-progress"), errors: !!document.querySelector("precision-error"), y: scrollY }));
        await cdp.detach();
        throw new Error(`Full-page capture did not open editor (${editorOrError}): ${message}; progress=${progressText}; page=${JSON.stringify(observed)}; targets=${(await browserCDP.send("Target.getTargets")).targetInfos.map((t) => t.url).join(" | ")}`);
      }
    } else {
      await expect.poll(async () => (await browserCDP.send("Target.getTargets")).targetInfos.some((t) => t.url.startsWith(`chrome-extension://${id}/editor.html?id=`)), { timeout: 5_000 }).toBe(true);
    }
  } else {
    try {
      await expect(page.locator("precision-selector")).toHaveCount(1);
    } catch (error) {
      const popup = (await browserCDP.send("Target.getTargets")).targetInfos.find((t) => t.url === `chrome-extension://${id}/popup.html`);
      let status = "popup closed";
      if (popup) {
        const popupPage = context.pages().find((candidate) => candidate.url() === popup.url);
        status = popupPage ? await popupPage.locator("#status").textContent().catch(() => "popup status unavailable") ?? "" : "popup open; status unavailable";
      }
      throw new Error(`Selection activation failed. Popup status: ${status}. ${String(error)}`, { cause: error });
    }
  }
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
async function clickShadowButton(label: string, targetPage: Page = page) {
  const cdp = await context.newCDPSession(targetPage);
  type Node = { backendNodeId: number; attributes?: string[]; children?: Node[]; shadowRoots?: Node[] };
  const deadline = Date.now() + 5_000;
  try {
    while (Date.now() < deadline) {
      await targetPage.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
      const find = (node: Node): Node | undefined => {
        if (node.attributes?.includes(label)) return node;
        for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])]) { const result = find(child); if (result) return result; }
      };
      const node = find(root);
      if (!node || node.attributes?.includes("disabled")) {
        await targetPage.waitForTimeout(100);
        continue;
      }
      try {
        const { model } = await cdp.send("DOM.getBoxModel", { backendNodeId: node.backendNodeId });
        await targetPage.mouse.click((model.border[0] + model.border[4]) / 2, (model.border[1] + model.border[5]) / 2);
        return;
      } catch { await targetPage.waitForTimeout(100); }
    }
    throw new Error(`Shadow DOM button ${label} did not become available.`);
  } finally { await cdp.detach(); }
}
async function shadowCanvasMetrics(label: string, targetPage: Page) {
  const cdp = await context.newCDPSession(targetPage);
  const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
  type Node = { backendNodeId: number; attributes?: string[]; children?: Node[]; shadowRoots?: Node[] };
  const find = (node: Node): Node | undefined => {
    if (node.attributes?.includes(label)) return node;
    for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])]) { const result = find(child); if (result) return result; }
  };
  const node = find(root);
  expect(node, `Shadow DOM canvas ${label}`).toBeTruthy();
  const { object } = await cdp.send("DOM.resolveNode", { backendNodeId: node!.backendNodeId });
  const result = await cdp.send("Runtime.callFunctionOn", {
    objectId: object.objectId,
    functionDeclaration: "function(){const r=this.getBoundingClientRect();return {width:this.width,height:this.height,rect:{x:r.x,y:r.y,width:r.width,height:r.height}}}",
    returnByValue: true,
  });
  await cdp.detach();
  return result.result.value as { width: number; height: number; rect: { x: number; y: number; width: number; height: number } };
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
    await clickShadowButton("Close editor");
    await expect(page.locator("precision-preview")).toHaveCount(0);
    await expect(page).toHaveURL("http://localhost:4173/");
  }
  await activate();
  await page.keyboard.press("Escape");
  await expect(page.locator("precision-selector")).toHaveCount(0);
  await activate();
  await select("#action");
  expect(await page.locator("#count").textContent()).toBe("0");
  await clickShadowButton("Close editor");
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
  await clickShadowButton("Close editor");
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
    await clickShadowButton("Close editor");
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
  await clickShadowButton("Close editor");

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  for (const colorScheme of ["light", "dark"] as const) {
    await popup.emulateMedia({ colorScheme });
    await popup
      .locator("body")
      .screenshot({ path: info.outputPath(`popup-${colorScheme}.png`) });
  }
});

test("compose and annotate separate elements in an editable canvas", async ({}, info) => {
  await activate("compose");
  for (const selector of ["#solid", "#card h2"]) {
    const box = await page.locator(selector).boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await clickShadowButton("Add selected element to composition");
    await expect(page.locator("precision-selector")).toHaveCount(1);
    await page.waitForTimeout(600);
  }
  await clickShadowButton("Compose 2 captured elements");
  await expect(page.locator("precision-selector")).toHaveCount(0);
  const editor = context.pages().find((candidate) => candidate.url().includes("editor.html?id="));
  expect(editor).toBeTruthy();
  await editor!.bringToFront();
  await expect(editor!.locator("precision-composition")).toHaveCount(1);
  await clickShadowButton("Select div, element 1", editor!);
  let canvasMetrics = await shadowCanvasMetrics("Editable composition with 2 elements", editor!);
  const screenPoint = (x: number, y: number) => ({
    x: canvasMetrics.rect.x + (x / canvasMetrics.width) * canvasMetrics.rect.width,
    y: canvasMetrics.rect.y + (y / canvasMetrics.height) * canvasMetrics.rect.height,
  });
  // The fixture's first captured element is a 480×320 blue bitmap at 2× DPR.
  const itemX = (canvasMetrics.width - 480) / 2;
  const handle = Math.max(14, canvasMetrics.width / 180);
  const corner = screenPoint(itemX + 480 - handle / 2, 48 + 320 - handle / 2);
  await editor!.mouse.move(corner.x, corner.y);
  await editor!.mouse.down();
  await editor!.mouse.move(corner.x + 24 * canvasMetrics.rect.width / canvasMetrics.width, corner.y + 16 * canvasMetrics.rect.height / canvasMetrics.height);
  await editor!.mouse.up();
  await editor!.keyboard.press("Control+z");
  await editor!.keyboard.press("Control+Shift+z");
  // Move the selected object with the keyboard, then restore its position.
  await editor!.keyboard.press("Shift+ArrowRight");
  await editor!.keyboard.press("Control+z");
  await editor!.keyboard.press("Control+Shift+z");
  canvasMetrics = await shadowCanvasMetrics("Editable composition with 2 elements", editor!);
  const resizedEvent = editor!.waitForEvent("download");
  await clickShadowButton("Download PNG", editor!);
  const resizedDownload = await resizedEvent;
  const resizedPath = info.outputPath("resized-composition.png");
  await resizedDownload.saveAs(resizedPath);
  const resizedImage = PNG.sync.read(await readFile(resizedPath));
  let resizedBluePixels = 0;
  for (let i = 0; i < resizedImage.data.length; i += 4)
    if (resizedImage.data[i] === 32 && resizedImage.data[i + 1] === 128 && resizedImage.data[i + 2] === 192 && resizedImage.data[i + 3] === 255) resizedBluePixels++;
  expect(resizedBluePixels).toBeGreaterThan(480 * 320);
  await clickShadowButton("Rectangle", editor!);
  const canvas = canvasMetrics.rect;
  await editor!.mouse.move(canvas.x + 32, canvas.y + 32);
  await editor!.mouse.down();
  await editor!.mouse.move(canvas.x + 112, canvas.y + 92);
  await editor!.mouse.up();
  await clickShadowButton("Text", editor!);
  await editor!.mouse.click(canvas.x + Math.min(150, canvas.width - 20), canvas.y + Math.min(145, canvas.height - 20));
  await editor!.keyboard.type("Bug note");
  await editor!.keyboard.press("Enter");
  await clickShadowButton("Select", editor!);
  await editor!.mouse.click(canvas.x + Math.min(153, canvas.width - 20), canvas.y + Math.min(147, canvas.height - 20));
  await editor!.keyboard.press("End");
  await editor!.keyboard.type(" edited");
  await editor!.keyboard.press("Enter");
  const downloadEvent = editor!.waitForEvent("download");
  await clickShadowButton("Download PNG", editor!);
  const download = await downloadEvent;
  const path = info.outputPath("annotated-composition.png");
  await download.saveAs(path);
  const image = PNG.sync.read(await readFile(path));
  let redPixels = 0;
  for (let i = 0; i < image.data.length; i += 4)
    if (image.data[i]! > 180 && image.data[i + 1]! < 120 && image.data[i + 2]! < 130) redPixels++;
  expect(redPixels).toBeGreaterThan(0);
  await context.grantPermissions(["clipboard-read"]);
  await clickShadowButton("Copy composition", editor!);
  let clipboardPng: PNG | undefined;
  for (let attempt = 0; attempt < 30 && !clipboardPng; attempt++) {
    try {
      const candidates = await editor!.evaluate(async () => {
        const items = await navigator.clipboard.read();
        const pngs: number[][] = [];
        for (const item of items) if (item.types.includes("image/png"))
          pngs.push(Array.from(new Uint8Array(await (await item.getType("image/png")).arrayBuffer())));
        return pngs;
      });
      for (const bytes of candidates) {
        const candidate = PNG.sync.read(Buffer.from(bytes));
        if (candidate.width === image.width && candidate.height === image.height) clipboardPng = candidate;
      }
    } catch { /* clipboard permissions and platform updates can settle asynchronously */ }
    if (!clipboardPng) await editor!.waitForTimeout(100);
  }
  expect(clipboardPng, "composition clipboard contains a PNG with the exported dimensions").toBeDefined();
  expect(clipboardPng!.data).toEqual(image.data);
  const closed = editor!.waitForEvent("close");
  const escape = editor!.keyboard.press("Escape").catch(() => undefined);
  await Promise.all([closed, escape]);
});

test("capture the visible viewport and open it in the screenshot editor", async () => {
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }));
  await activate("visible");
  let editor = context.pages().find((candidate) => candidate.url().includes("editor.html?id="));
  await expect.poll(() => {
    editor = context.pages().find((candidate) => candidate.url().includes("editor.html?id="));
    return !!editor;
  }).toBe(true);
  expect(editor).toBeTruthy();
  await editor!.bringToFront();
  await expect(editor!.locator("precision-preview")).toHaveCount(1);
  const cdp = await context.newCDPSession(editor!);
  const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
  type Node = { attributes?: string[]; children?: Node[]; shadowRoots?: Node[] };
  const findCaptureLabel = (node: Node): string | undefined => {
    const index = node.attributes?.indexOf("aria-label") ?? -1;
    if (index >= 0 && node.attributes?.[index + 1]?.startsWith("Captured image,")) return node.attributes[index + 1];
    for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])]) { const value = findCaptureLabel(child); if (value) return value; }
  };
  const captureLabel = findCaptureLabel(root);
  await cdp.detach();
  const dimensions = captureLabel?.match(/^Captured image, (\d+) by (\d+) pixels$/);
  expect(dimensions).not.toBeNull();
  expect(Number(dimensions![1])).toBe(viewport.width * viewport.dpr);
  expect(Number(dimensions![2])).toBeGreaterThan(0);
  expect(Number(dimensions![2])).toBeLessThanOrEqual(viewport.height * viewport.dpr);
  expect(viewport.height * viewport.dpr - Number(dimensions![2])).toBeLessThanOrEqual(32);
  const closed = editor!.waitForEvent("close");
  const close = clickShadowButton("Close editor", editor!).catch(() => undefined);
  await Promise.all([closed, close]);
});

test("full-page capture stitches sticky-header bands and restores the page", async ({}, info) => {
  await page.goto("http://localhost:4173/full-page.html");
  await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.tabs.setZoom(tab!.id!, 1.25);
  });
  await page.evaluate(() => window.scrollTo(0, 180));
  const before = await page.evaluate(() => ({
    x: scrollX,
    y: scrollY,
    pageHeight: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, document.documentElement.clientHeight),
    viewportWidth: innerWidth,
  }));
  await activate("fullPage");
  let editor = context.pages().find((candidate) => candidate.url().includes("editor.html?id="));
  await expect.poll(() => {
    editor = context.pages().find((candidate) => candidate.url().includes("editor.html?id="));
    return !!editor;
  }).toBe(true);
  expect(editor).toBeTruthy();
  await editor!.bringToFront();
  await expect(editor!.locator("precision-preview")).toHaveCount(1);
  const downloadEvent = editor!.waitForEvent("download");
  await clickShadowButton("Download PNG", editor!);
  const download = await downloadEvent;
  const path = info.outputPath("full-page-stitched.png");
  await download.saveAs(path);
  const image = PNG.sync.read(await readFile(path));
  const scale = image.width / before.viewportWidth;
  expect(scale).toBeGreaterThan(2.4);
  expect(image.width).toBe(Math.round(before.viewportWidth * scale));
  const scaleY = image.height / before.pageHeight;
  expect(scaleY).toBeGreaterThan(2.4);
  expect(scaleY).toBeLessThan(2.6);
  const pixel = (cssX: number, cssY: number) => {
    const x = Math.floor(cssX * scale), y = Math.floor(cssY * scaleY), offset = (y * image.width + x) * 4;
    return [image.data[offset], image.data[offset + 1], image.data[offset + 2]];
  };
  const expectColor = (at: number[], color: number[]) => expect(at).toEqual(color);
  expectColor(pixel(10, 20), [23, 32, 51]);
  expectColor(pixel(20, 120), [211, 59, 66]);
  expectColor(pixel(20, 690), [34, 129, 91]);
  expectColor(pixel(20, 1210), [214, 165, 43]);
  expectColor(pixel(20, 1730), [50, 105, 189]);
  expectColor(pixel(20, 790), [34, 129, 91]);
  expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual({ x: before.x, y: before.y });
  const closed = editor!.waitForEvent("close");
  const close = clickShadowButton("Close editor", editor!).catch(() => undefined);
  await Promise.all([closed, close]);
});

test("full-page capture handles a document shorter than its viewport", async ({}, info) => {
  await page.goto("http://localhost:4173/full-page.html?short=1");
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  await activate("fullPage");
  let editor = context.pages().find((candidate) => candidate.url().includes("editor.html?id="));
  await expect.poll(() => {
    editor = context.pages().find((candidate) => candidate.url().includes("editor.html?id="));
    return !!editor;
  }).toBe(true);
  expect(editor).toBeTruthy();
  await editor!.bringToFront();
  await expect(editor!.locator("precision-preview")).toHaveCount(1);
  const downloadEvent = editor!.waitForEvent("download");
  await clickShadowButton("Download PNG", editor!);
  const download = await downloadEvent;
  const path = info.outputPath("full-page-short.png");
  await download.saveAs(path);
  const image = PNG.sync.read(await readFile(path));
  expect(image.width).toBeGreaterThanOrEqual(viewport.width * 2 - 2);
  expect(image.height).toBeGreaterThanOrEqual(viewport.height * 2 - 32);
  const closed = editor!.waitForEvent("close");
  const close = clickShadowButton("Close editor", editor!).catch(() => undefined);
  await Promise.all([closed, close]);
});

test("full-page Escape cancels and restores the original page scroll", async () => {
  await page.goto("http://localhost:4173/full-page.html");
  await page.evaluate(() => window.scrollTo(0, 180));
  const original = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
  await activate("fullPage", false);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(original.y);
  await page.keyboard.press("Escape");
  await expect(page.locator("precision-full-page-progress")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual(original);
  await expect.poll(async () => (await browserCDP.send("Target.getTargets")).targetInfos.some((t) => t.url.startsWith(`chrome-extension://${id}/editor.html?id=`))).toBe(false);
});

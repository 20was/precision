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
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
let context: BrowserContext,
  worker: Worker,
  page: Page,
  browserCDP: CDPSession,
  id: string,
  browserProfile: string | undefined;
const selectAllShortcut = process.platform === "darwin" ? "Meta+a" : "Control+a";
const execFileAsync = promisify(execFile);
const paths: Record<string, string> = {
  chrome: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  brave: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
};
async function activate(mode: "element" | "region" | "visible" | "fullPage" | "compose" = "element", waitForResult = true, waitForPopupStatus?: string) {
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
  let commandId = 0;
  const sendPopupCommand = (method: string, params: Record<string, unknown>) => {
    const id = ++commandId;
    return new Promise<{ result?: { value?: unknown; objectId?: string } }>((resolve, reject) => {
      const timeout = setTimeout(() => {
        browserCDP.off("Target.receivedMessageFromTarget", onResponse);
        reject(new Error("The extension popup did not acknowledge its capture action."));
      }, 5_000);
      const onResponse = (event: { sessionId: string; message: string }) => {
        if (event.sessionId !== sessionId) return;
        let response: { id?: number; result?: { result?: { value?: unknown; objectId?: string }; exceptionDetails?: { text?: string } }; error?: { message?: string } };
        try { response = JSON.parse(event.message); } catch { return; }
        if (response.id !== id) return;
        clearTimeout(timeout);
        browserCDP.off("Target.receivedMessageFromTarget", onResponse);
        if (response.error || response.result?.exceptionDetails)
          reject(new Error(response.error?.message ?? response.result?.exceptionDetails?.text ?? "The popup action failed."));
        else resolve(response.result);
      };
      browserCDP.on("Target.receivedMessageFromTarget", onResponse);
      void browserCDP.send("Target.sendMessageToTarget", {
        sessionId,
        message: JSON.stringify({ id, method, params }),
      }).catch((error) => {
        clearTimeout(timeout);
        browserCDP.off("Target.receivedMessageFromTarget", onResponse);
        reject(error);
      });
    });
  };
  try {
    const documentResponse = await sendPopupCommand("Runtime.evaluate", { expression: "document" });
    const objectId = documentResponse.result?.objectId;
    if (!objectId) throw new Error("The extension popup document is unavailable.");
    await sendPopupCommand("Runtime.callFunctionOn", {
      objectId,
      functionDeclaration: "async function(mode){if(this.readyState==='loading')await new Promise(resolve=>this.addEventListener('DOMContentLoaded',resolve,{once:true}));const button=Array.from(this.querySelectorAll('button[data-mode]')).find(candidate=>candidate.dataset.mode===mode);if(!button)throw new Error('Capture mode button is missing');button.click();return button.dataset.mode}",
      arguments: [{ value: mode }],
      awaitPromise: true,
      userGesture: true,
    });
    if (waitForPopupStatus) {
      await expect.poll(async () => {
        const result = await sendPopupCommand("Runtime.evaluate", {
          expression: "document.querySelector('#status')?.textContent ?? ''",
        });
        return result.result?.value ?? "";
      }, { timeout: 20_000, intervals: [200, 500] }).toContain(waitForPopupStatus);
      await expect.poll(async () => {
        const result = await sendPopupCommand("Runtime.evaluate", {
          expression: "document.querySelector('button[data-mode=fullPage]')?.disabled === false",
        });
        return result.result?.value;
      }).toBe(true);
    }
  } finally {
    await browserCDP.send("Target.detachFromTarget", { sessionId }).catch(() => {});
  }
  if (waitForPopupStatus) return;
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
async function startMacFootprintSampler(outputPath: string) {
  const profile = browserProfile;
  if (!profile) throw new Error("Could not identify the active Playwright Chromium profile.");
  const { stdout } = await execFileAsync("ps", ["-Ao", "pid=,command="], { maxBuffer: 8 * 1024 * 1024 });
  const browser = stdout.split("\n").find((line) => line.includes(`--user-data-dir=${profile}`) && !line.includes(" --type="));
  const pid = browser?.trim().split(/\s+/, 1)[0];
  if (!pid) throw new Error("Could not identify isolated Playwright Chromium for footprint sampling.");
  const sampler = spawn("footprint", ["--pid", pid, "-t", "--sample", "0.2", "--sample-duration", "30", "--json", outputPath, "--noCategories"], { stdio: "ignore" });
  const completion = new Promise<void>((resolve, reject) => {
    sampler.once("error", reject);
    sampler.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`macOS footprint exited with status ${code}.`)));
  });
  return { completion, pid };
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
  const outcome = await page.evaluate(() => new Promise<"preview" | "error" | "timeout">((resolve) => {
    const check = () => {
      if (document.querySelector("precision-preview")) return finish("preview");
      if (document.querySelector("precision-error")) return finish("error");
    };
    const observer = new MutationObserver(check);
    const timer = window.setTimeout(() => finish("timeout"), 5_000);
    const finish = (result: "preview" | "error" | "timeout") => {
      observer.disconnect();
      window.clearTimeout(timer);
      resolve(result);
    };
    observer.observe(document.documentElement, { childList: true, subtree: true });
    check();
  }));
  if (outcome === "error")
    throw new Error(`Element capture failed: ${await shadowHostText("precision-error", page)}`);
  expect(outcome, "capture should create a preview or show its actionable error").toBe("preview");
  console.log("Click to decoded preview ms", Math.round(performance.now() - started));
  return page;
}
async function shadowHostText(tagName: string, targetPage: Page) {
  const cdp = await context.newCDPSession(targetPage);
  type Node = { nodeName?: string; nodeValue?: string; children?: Node[]; shadowRoots?: Node[] };
  try {
    const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
    const find = (node: Node): Node | undefined => node.nodeName?.toLowerCase() === tagName
      ? node
      : [...(node.children ?? []), ...(node.shadowRoots ?? [])].map(find).find(Boolean);
    const host = find(root as Node);
    if (!host) return "no error message was attached";
    const text = (node: Node): string => `${node.nodeValue ?? ""}${(node.children ?? []).map(text).join(" ")}${(node.shadowRoots ?? []).map(text).join(" ")}`;
    return text(host).replace(/\s+/g, " ").trim();
  } finally { await cdp.detach(); }
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
    const host = await shadowHostText("precision-selector", targetPage).catch(() => "selector host unavailable");
    const error = await shadowHostText("precision-error", targetPage).catch(() => "no error host");
    const editor = await shadowHostText("precision-composition", targetPage).catch(() => "no composition editor");
    throw new Error(`Shadow DOM button ${label} did not become available. Selector: ${host}. Error: ${error}. Editor: ${editor}.`);
  } finally { await cdp.detach(); }
}
async function dragShadowControl(label: string, dx: number, dy: number, targetPage: Page = page) {
  const cdp = await context.newCDPSession(targetPage);
  type Node = { backendNodeId: number; attributes?: string[]; children?: Node[]; shadowRoots?: Node[] };
  try {
    const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
    const find = (node: Node): Node | undefined => {
      if (node.attributes?.includes(label)) return node;
      for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])]) { const found = find(child); if (found) return found; }
    };
    const handle = find(root);
    expect(handle, `Missing resize handle ${label}`).toBeTruthy();
    const { model } = await cdp.send("DOM.getBoxModel", { backendNodeId: handle!.backendNodeId });
    const x = (model.border[0] + model.border[4]) / 2;
    const y = (model.border[1] + model.border[5]) / 2;
    await targetPage.mouse.move(x, y);
    await targetPage.mouse.down();
    await targetPage.mouse.move(x + dx, y + dy, { steps: 4 });
    await targetPage.mouse.up();
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
async function setShadowInput(label: string, value: string, targetPage: Page) {
  const cdp = await context.newCDPSession(targetPage);
  type Node = { backendNodeId: number; attributes?: string[]; children?: Node[]; shadowRoots?: Node[] };
  try {
    const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
    const find = (node: Node): Node | undefined => {
      if (node.attributes?.includes(label)) return node;
      for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])]) { const result = find(child); if (result) return result; }
    };
    const node = find(root);
    expect(node, `Shadow DOM input ${label}`).toBeTruthy();
    const { object } = await cdp.send("DOM.resolveNode", { backendNodeId: node!.backendNodeId });
    await cdp.send("Runtime.callFunctionOn", {
      objectId: object.objectId,
      functionDeclaration: "function(value){this.value=value;this.dispatchEvent(new Event('input',{bubbles:true,composed:true}));this.dispatchEvent(new Event('change',{bubbles:true,composed:true}))}",
      arguments: [{ value }],
    });
  } finally { await cdp.detach(); }
}
async function readShadowCanvas(label: string, targetPage: Page) {
  const cdp = await context.newCDPSession(targetPage);
  type Node = { backendNodeId: number; attributes?: string[]; children?: Node[]; shadowRoots?: Node[] };
  try {
    const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
    const find = (node: Node): Node | undefined => {
      if (node.nodeName === "CANVAS" && node.attributes?.includes(label)) return node;
      for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])]) { const result = find(child); if (result) return result; }
    };
    const node = find(root);
    expect(node, `Shadow DOM canvas ${label}`).toBeTruthy();
    const { object } = await cdp.send("DOM.resolveNode", { backendNodeId: node!.backendNodeId });
    const result = await cdp.send("Runtime.callFunctionOn", {
      objectId: object.objectId,
      functionDeclaration: "function(){return this.toDataURL('image/png')}",
      returnByValue: true,
    });
    const dataUrl = result.result.value as string;
    return PNG.sync.read(Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"));
  } finally { await cdp.detach(); }
}
async function shadowAttribute(label: string, attribute: string, targetPage: Page) {
  const cdp = await context.newCDPSession(targetPage);
  type Node = { backendNodeId: number; attributes?: string[]; children?: Node[]; shadowRoots?: Node[] };
  try {
    const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
    const find = (node: Node): Node | undefined => {
      if (node.attributes?.includes(label)) return node;
      for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])]) { const result = find(child); if (result) return result; }
    };
    const node = find(root);
    expect(node, `Shadow DOM node ${label}`).toBeTruthy();
    const attrs = node!.attributes ?? [];
    const index = attrs.indexOf(attribute);
    return index < 0 ? null : attrs[index + 1] ?? null;
  } finally { await cdp.detach(); }
}
async function focusShadowElement(label: string, targetPage: Page) {
  const cdp = await context.newCDPSession(targetPage);
  type Node = { backendNodeId: number; attributes?: string[]; children?: Node[]; shadowRoots?: Node[] };
  try {
    const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
    const find = (node: Node): Node | undefined => {
      if (node.attributes?.includes(label)) return node;
      for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])]) { const result = find(child); if (result) return result; }
    };
    const node = find(root);
    expect(node, `Shadow DOM element ${label}`).toBeTruthy();
    const { object } = await cdp.send("DOM.resolveNode", { backendNodeId: node!.backendNodeId });
    await cdp.send("Runtime.callFunctionOn", { objectId: object.objectId, functionDeclaration: "function(){this.focus({preventScroll:true})}" });
  } finally { await cdp.detach(); }
}
async function shadowPreviewFrameMetrics(targetPage: Page) {
  const cdp = await context.newCDPSession(targetPage);
  type Node = { backendNodeId: number; nodeName?: string; attributes?: string[]; children?: Node[]; shadowRoots?: Node[] };
  try {
    const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
    const find = (node: Node): Node | undefined => {
      const classes = node.attributes?.[node.attributes.indexOf("class") + 1] ?? "";
      if (classes.split(/\s+/).includes("frame-titlebar")) return node;
      for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])]) { const result = find(child); if (result) return result; }
    };
    const node = find(root);
    expect(node, "Mac frame titlebar in preview shadow DOM").toBeTruthy();
    const { object } = await cdp.send("DOM.resolveNode", { backendNodeId: node!.backendNodeId });
    const result = await cdp.send("Runtime.callFunctionOn", {
      objectId: object.objectId,
    functionDeclaration: "function(){const root=this.getRootNode(),bar=this,dots=root.querySelector('.frame-dots'),url=root.querySelector('.frame-url'),time=root.querySelector('.capture-time'),controls=root.querySelector('.frame-window-controls'),canvas=root.querySelector('canvas'),wrap=root.querySelector('.canvas-wrap'),surface=root.querySelector('.frame-surface'),panel=root.querySelector('.panel'),head=panel.querySelector('.head'),actions=root.querySelector('.actions'),view=root.querySelector('.image-viewport'),r=el=>el.getBoundingClientRect(),cr=r(controls),ur=r(url),tr=r(time),br=r(bar),ar=r(actions),vr=r(view),wr=r(wrap),sr=r(surface),c=r(canvas),bottomInset=parseFloat(getComputedStyle(canvas).marginBottom)||0,stacked=bar.dataset.stacked==='true',timeControlsSeparated=tr.right<=cr.left+1||cr.right<=tr.left+1||tr.bottom<=cr.top+1||cr.bottom<=tr.top+1,urlTimeSeparated=ur.right<=tr.left+1||tr.right<=ur.left+1||ur.bottom<=tr.top+1||tr.bottom<=ur.top+1;return {visible:getComputedStyle(bar).display==='grid',stacked,macDotsVisible:getComputedStyle(dots).display!=='none'&&r(dots).width>0,macDotSize:r(dots.firstElementChild).width,actionsInHeader:ar.top>=r(head).top&&ar.bottom<=r(head).bottom,footerAbsent:!panel.querySelector('.footer'),headerFits:head.scrollWidth<=head.clientWidth+1,centeredX:Math.abs((br.left+br.right-vr.left-vr.right)/2)<1,centeredY:Math.abs((br.top+c.bottom+bottomInset-vr.top-vr.bottom)/2)<1,centerAnchorX:(vr.left+view.clientWidth/2-br.left)/br.width,centerAnchorY:(vr.top+view.clientHeight/2-br.top)/br.width,viewBounds:{x:vr.left,y:vr.top,width:vr.width,height:vr.height,scrollLeft:view.scrollLeft,scrollTop:view.scrollTop},urlAndTimeShareRow:Math.abs((ur.top+ur.bottom-tr.top-tr.bottom)/2)<1,metadataRowsSeparated:ur.bottom<=tr.top+1,timestampFits:time.scrollWidth<=time.clientWidth+1&&tr.right<=br.right,timeControlsSeparated:bar.dataset.style!=='windows'||timeControlsSeparated,urlTimeSeparated,urlCentered:Math.abs((ur.left+ur.right-br.left-br.right)/2)<1,urlFieldVisible:getComputedStyle(url).display!=='none'&&!url.hidden,urlText:url.textContent,timeVisible:getComputedStyle(time).display!=='none',urlPressed:root.querySelector('[aria-label=\"Show page URL in screenshot frame\"]').getAttribute('aria-pressed')==='true',offControlsHidden:bar.dataset.style!=='none'||getComputedStyle(controls).display==='none',urlDisabled:root.querySelector('[aria-label=\"Show page URL in screenshot frame\"]').disabled,frameBackground:getComputedStyle(surface).backgroundColor,frameOutline:getComputedStyle(surface).outlineColor,frameSurfaceWidth:sr.width,windowsControlsRight:getComputedStyle(controls).display!=='none'&&cr.right>br.left+br.width*.6&&cr.right<=br.right,barWidth:br.width,barHeight:br.height,canvasWidth:c.width,headHeight:r(head).height,footerHeight:0,urlFont:getComputedStyle(url).fontFamily,timeFont:getComputedStyle(time).fontFamily,timeText:time.textContent}}",
      returnByValue: true,
    });
    return result.result.value as { visible: boolean; stacked: boolean; macDotsVisible: boolean; macDotSize: number; actionsInHeader: boolean; footerAbsent: boolean; headerFits: boolean; centeredX: boolean; centeredY: boolean; centerAnchorX: number; centerAnchorY: number; viewBounds: { x: number; y: number; width: number; height: number; scrollLeft: number; scrollTop: number }; urlAndTimeShareRow: boolean; metadataRowsSeparated: boolean; timestampFits: boolean; timeControlsSeparated: boolean; urlTimeSeparated: boolean; urlCentered: boolean; urlFieldVisible: boolean; urlText: string; timeVisible: boolean; offControlsHidden: boolean; urlDisabled: boolean; urlPressed: boolean; frameBackground: string; frameOutline: string; frameSurfaceWidth: number; windowsControlsRight: boolean; barWidth: number; barHeight: number; canvasWidth: number; headHeight: number; footerHeight: number; urlFont: string; timeFont: string; timeText: string };
  } finally { await cdp.detach(); }
}
async function shadowControlIsFocused(label: string, targetPage: Page) {
  const cdp = await context.newCDPSession(targetPage);
  type Node = { backendNodeId: number; attributes?: string[]; children?: Node[]; shadowRoots?: Node[] };
  try {
    const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
    const find = (node: Node): Node | undefined => {
      if (node.attributes?.includes(label)) return node;
      for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])]) { const result = find(child); if (result) return result; }
    };
    const node = find(root);
    expect(node, `Shadow DOM control ${label}`).toBeTruthy();
    const { object } = await cdp.send("DOM.resolveNode", { backendNodeId: node!.backendNodeId });
    const result = await cdp.send("Runtime.callFunctionOn", { objectId: object.objectId, functionDeclaration: "function(){return this.matches(':focus')}", returnByValue: true });
    return result.result.value as boolean;
  } finally { await cdp.detach(); }
}
async function shadowHostIsFocused(tagName: string, targetPage: Page) {
  const cdp = await context.newCDPSession(targetPage);
  type Node = { backendNodeId: number; nodeName?: string; children?: Node[]; shadowRoots?: Node[] };
  try {
    const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
    const find = (node: Node): Node | undefined => node.nodeName?.toLowerCase() === tagName
      ? node
      : [...(node.children ?? []), ...(node.shadowRoots ?? [])].map(find).find(Boolean);
    const host = find(root);
    expect(host, `Shadow DOM host ${tagName}`).toBeTruthy();
    const { object } = await cdp.send("DOM.resolveNode", { backendNodeId: host!.backendNodeId });
    const result = await cdp.send("Runtime.callFunctionOn", { objectId: object.objectId, functionDeclaration: "function(){return this.matches(':focus')}", returnByValue: true });
    return result.result.value as boolean;
  } finally { await cdp.detach(); }
}
async function clickShadowText(label: string, targetPage: Page = page) {
  const cdp = await context.newCDPSession(targetPage);
  type Node = { backendNodeId: number; nodeName?: string; nodeValue?: string; children?: Node[]; shadowRoots?: Node[] };
  try {
    const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
    const text = (node: Node): string => `${node.nodeValue ?? ""}${(node.children ?? []).map(text).join("")}${(node.shadowRoots ?? []).map(text).join("")}`;
    const find = (node: Node): Node | undefined => ["BUTTON", "SUMMARY"].includes(node.nodeName ?? "") && (text(node).trim() === label || (node.nodeName === "SUMMARY" && text(node).trim().startsWith(label)))
      ? node
      : [...(node.children ?? []), ...(node.shadowRoots ?? [])].map(find).find(Boolean);
    const button = find(root as Node);
    expect(button, `Shadow DOM button text ${label}`).toBeTruthy();
    const { model } = await cdp.send("DOM.getBoxModel", { backendNodeId: button!.backendNodeId });
    await targetPage.mouse.click((model.border[0]! + model.border[4]!) / 2, (model.border[1]! + model.border[5]!) / 2);
  } finally { await cdp.detach(); }
}
async function centerCanvasPointInViewport(label: string, x: number, y: number, targetPage: Page) {
  const cdp = await context.newCDPSession(targetPage);
  type Node = { backendNodeId: number; nodeName?: string; attributes?: string[]; children?: Node[]; shadowRoots?: Node[] };
  try {
    const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
    const find = (node: Node): Node | undefined => {
      if (node.nodeName === "CANVAS" && node.attributes?.includes(label)) return node;
      for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])]) { const result = find(child); if (result) return result; }
    };
    const node = find(root);
    expect(node, `Shadow DOM canvas ${label}`).toBeTruthy();
    const { object } = await cdp.send("DOM.resolveNode", { backendNodeId: node!.backendNodeId });
    await cdp.send("Runtime.callFunctionOn", {
      objectId: object.objectId,
      functionDeclaration: "function(x,y){const viewport=this.parentElement.parentElement,canvas=this.getBoundingClientRect(),view=viewport.getBoundingClientRect();viewport.scrollLeft+=canvas.left-view.left+x*canvas.width/this.width-viewport.clientWidth/2;viewport.scrollTop+=canvas.top-view.top+y*canvas.height/this.height-viewport.clientHeight/2}",
      arguments: [{ value: x }, { value: y }],
    });
  } finally { await cdp.detach(); }
}
function canvasClientPoint(metrics: { width: number; height: number; rect: { x: number; y: number; width: number; height: number } }, x: number, y: number) {
  return { x: metrics.rect.x + (x / metrics.width) * metrics.rect.width, y: metrics.rect.y + (y / metrics.height) * metrics.rect.height };
}
async function exportComposition(editor: Page, path: string) {
  const downloadEvent = editor.waitForEvent("download");
  await clickShadowButton("Download PNG", editor);
  const download = await downloadEvent;
  await download.saveAs(path);
  return PNG.sync.read(await readFile(path));
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
  browserProfile = info.title.includes("near-limit full-page capture")
    ? resolve("test-results", `near-limit-profile-${process.pid}-${Date.now()}`)
    : undefined;
  context = await chromium.launchPersistentContext(browserProfile ?? "", {
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
  browserProfile = undefined;
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

test("Mac frame preview keeps the window chrome and metadata in one export-sized titlebar", async ({}, info) => {
  await page.locator("#solid").evaluate((el) => {
    (el as HTMLElement).style.cssText = "position:fixed;left:40px;top:140px;width:360px;height:220px;background:rgb(32,128,192);z-index:5";
  });
  await activate("region");
  const box = await page.locator("#solid").boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + 10, box!.y + 10);
  await page.mouse.down();
  await page.mouse.move(box!.x + 120, box!.y + 100, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => shadowAttribute("Preview selected region", "disabled", page)).toBeNull();
  await clickShadowButton("Preview selected region");
  await expect(page.locator("precision-preview")).toHaveCount(1);
  await clickShadowButton("Choose screenshot window frame");
  await clickShadowButton("Frame: Mac");
  await clickShadowButton("Show capture date and time in screenshot");
  const preview = await shadowPreviewFrameMetrics(page);
  expect(preview.visible).toBe(true);
  expect(preview.stacked).toBe(true);
  expect(preview.macDotsVisible).toBe(true);
  expect(preview.macDotSize).toBeGreaterThanOrEqual(15);
  expect(preview.metadataRowsSeparated).toBe(true);
  expect(preview.timestampFits).toBe(true);
  expect(preview.timeText).toContain("GMT");
  expect(preview.barWidth).toBeGreaterThan(preview.canvasWidth);
  expect(preview.barWidth - preview.canvasWidth).toBeLessThan(80);
  expect(preview.urlFont).toBe(preview.timeFont);
  expect(preview.headHeight).toBeLessThanOrEqual(50);
  expect(preview.footerHeight).toBeLessThanOrEqual(52);
  expect(preview.actionsInHeader).toBe(true);
  expect(preview.footerAbsent).toBe(true);
  expect(preview.centeredX).toBe(true);
  expect(preview.centeredY).toBe(true);
  await page.setViewportSize({ width: 390, height: 700 });
  expect((await shadowPreviewFrameMetrics(page)).headerFits).toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  if (info.project.name === "chromium") await page.screenshot({ path: info.outputPath("mac-frame-preview-aligned.png") });
  await clickShadowButton("Screenshot frame: Mac");
  await clickShadowButton("Frame: Windows");
  const windowsPreview = await shadowPreviewFrameMetrics(page);
  expect(windowsPreview.windowsControlsRight).toBe(true);
  expect(windowsPreview.timeControlsSeparated).toBe(true);
  await clickShadowButton("Close editor");
});
test("wide screenshot frame preview keeps URL and timestamp readable on one row", async ({}, info) => {
  await activate("visible");
  await expect.poll(() => context.pages().some((candidate) => candidate.url().includes("/editor.html?id="))).toBe(true);
  const editor = context.pages().find((candidate) => candidate.url().includes("/editor.html?id="));
  expect(editor).toBeTruthy();
  await expect(editor!.locator("precision-preview")).toHaveCount(1);
  await clickShadowButton("Show capture date and time in screenshot", editor!);
  const noFramePreview = await shadowPreviewFrameMetrics(editor!);
  expect(noFramePreview.visible).toBe(true);
  expect(noFramePreview.offControlsHidden).toBe(true);
  expect(noFramePreview.urlDisabled).toBe(true);
  await clickShadowButton("Show capture date and time in screenshot", editor!);
  await clickShadowButton("Choose screenshot window frame", editor!);
  await clickShadowButton("Frame: Mac", editor!);
  await clickShadowButton("Show capture date and time in screenshot", editor!);
  const preview = await shadowPreviewFrameMetrics(editor!);
  expect(preview.stacked).toBe(false);
  expect(preview.macDotsVisible).toBe(true);
  expect(preview.urlAndTimeShareRow).toBe(true);
  expect(preview.timestampFits).toBe(true);
  expect(preview.urlCentered).toBe(true);
  expect(preview.urlPressed).toBe(true);
  await clickShadowButton("Show page URL in screenshot frame", editor!);
  await expect.poll(async () => shadowAttribute("Show page URL in screenshot frame", "aria-pressed", editor!)).toBe("false");
  const privateUrlPreview = await shadowPreviewFrameMetrics(editor!);
  expect(privateUrlPreview.urlFieldVisible).toBe(true);
  expect(privateUrlPreview.urlText).toBe("");
  if (info.project.name === "chromium") await editor!.screenshot({ path: info.outputPath("mac-frame-private-url.png") });
  await clickShadowButton("Show page URL in screenshot frame", editor!);
  await clickShadowButton("Show capture date and time in screenshot", editor!);
  const urlOnlyPreview = await shadowPreviewFrameMetrics(editor!);
  expect(urlOnlyPreview.urlPressed).toBe(true);
  expect(urlOnlyPreview.timeVisible).toBe(false);
  if (info.project.name === "chromium") await editor!.screenshot({ path: info.outputPath("mac-frame-url-only.png") });
  await clickShadowButton("Show capture date and time in screenshot", editor!);
  expect(preview.urlTimeSeparated).toBe(true);
  expect(preview.frameBackground).toBe("rgb(230, 232, 235)");
  expect(preview.frameOutline).toBe("rgb(207, 210, 214)");
  expect(Math.abs(preview.frameSurfaceWidth - preview.barWidth)).toBeLessThan(2);
  expect(preview.timeText).toMatch(/GMT|UTC|[A-Z]{3}/);
  if (info.project.name === "chromium") await editor!.screenshot({ path: info.outputPath("wide-frame-preview-aligned.png") });
  await clickShadowButton("Choose screenshot window frame", editor!);
  await clickShadowButton("Frame: Off", editor!);
  const offWithUrlSaved = await shadowPreviewFrameMetrics(editor!);
  expect(offWithUrlSaved.urlDisabled).toBe(true);
  expect(offWithUrlSaved.urlPressed).toBe(false);
  await clickShadowButton("Choose screenshot window frame", editor!);
  await clickShadowButton("Frame: Windows", editor!);
  const windowsPreview = await shadowPreviewFrameMetrics(editor!);
  expect(windowsPreview.stacked).toBe(false);
  expect(windowsPreview.windowsControlsRight).toBe(true);
  expect(windowsPreview.timeControlsSeparated).toBe(true);
  expect(windowsPreview.urlPressed).toBe(true);
  const centerBefore = await shadowPreviewFrameMetrics(editor!);
  await clickShadowButton("Zoom in (+)", editor!);
  const centerAfter = await shadowPreviewFrameMetrics(editor!);
  expect(Math.abs(centerAfter.centerAnchorX - centerBefore.centerAnchorX)).toBeLessThan(0.01);
  expect(Math.abs(centerAfter.centerAnchorY - centerBefore.centerAnchorY)).toBeLessThan(0.01);
  await focusShadowElement("Screenshot canvas. Hold Space and drag to pan.", editor!);
  const panStart = await shadowPreviewFrameMetrics(editor!);
  await editor!.keyboard.down("Space");
  const startX = panStart.viewBounds.x + panStart.viewBounds.width * 0.7;
  const startY = panStart.viewBounds.y + panStart.viewBounds.height * 0.5;
  await editor!.mouse.move(startX, startY);
  await editor!.mouse.down();
  await editor!.mouse.move(startX - 40, startY, { steps: 4 });
  await editor!.mouse.up();
  await editor!.keyboard.up("Space");
  const panEnd = await shadowPreviewFrameMetrics(editor!);
  expect(panEnd.viewBounds.scrollLeft).toBeGreaterThan(panStart.viewBounds.scrollLeft);
});
test("custom region corner handles resize the crop before same-page copy and preview", async ({}, info) => {
  await context.grantPermissions(["clipboard-read"]);
  await page.locator("#solid").evaluate((el) => {
    (el as HTMLElement).style.cssText = "position:fixed;left:40px;top:140px;width:240px;height:160px;background:rgb(32,128,192);z-index:5";
  });
  const dragArea = async (reverse = false) => {
    const box = await page.locator("#solid").boundingBox();
    expect(box).not.toBeNull();
    const startX = reverse ? box!.x + 110 : box!.x + 10;
    const startY = reverse ? box!.y + 90 : box!.y + 10;
    const endX = reverse ? box!.x + 10 : box!.x + 110;
    const endY = reverse ? box!.y + 10 : box!.y + 90;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY, { steps: 6 });
    await page.mouse.up();
  };
  const checkFlatPng = (png: { width: number; height: number; data: Uint8Array }, width = 200, height = 160) => {
    expect(png.width).toBe(width);
    expect(png.height).toBe(height);
    let wrong = 0;
    for (let i = 0; i < png.data.length; i += 4) {
      if (Math.abs(png.data[i]! - 32) > 1 || Math.abs(png.data[i + 1]! - 128) > 1 || Math.abs(png.data[i + 2]! - 192) > 1 || png.data[i + 3] !== 255) {
        wrong++;
      }
    }
    expect(wrong).toBe(0);
  };

  await activate("region");
  await expect(page.locator("precision-selector")).toHaveCount(1);
  await dragArea();
  await expect.poll(() => shadowAttribute("Resize selection from bottom right", "hidden", page)).toBeNull();
  await dragShadowControl("Resize selection from bottom right", 10, 10);
  await expect.poll(async () => shadowHostText("precision-selector", page)).toContain("110 × 90 px");
  if (info.project.name === "chromium") await page.screenshot({ path: info.outputPath("region-selected-toolbar.png") });
  await expect.poll(() => shadowAttribute("Copy selected region", "disabled", page)).toBeNull();
  await expect.poll(() => shadowAttribute("Preview selected region", "disabled", page)).toBeNull();
  const pagesBeforeCopy = context.pages().length;
  await clickShadowButton("Copy selected region");
  await expect(page.locator("precision-notice")).toHaveCount(1);
  expect(context.pages()).toHaveLength(pagesBeforeCopy);
  const copied = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const image = await createImageBitmap(await items[0]!.getType("image/png"));
    const canvas = new OffscreenCanvas(image.width, image.height), ctx = canvas.getContext("2d")!;
    ctx.drawImage(image, 0, 0);
    return { width: image.width, height: image.height, data: Array.from(ctx.getImageData(0, 0, image.width, image.height).data) };
  });
  checkFlatPng({ width: copied.width, height: copied.height, data: Uint8Array.from(copied.data) }, 220, 180);

  await page.waitForTimeout(650);
  await activate("region");
  await dragArea(true);
  await dragShadowControl("Resize selection from top left", -10, -10);
  await expect.poll(async () => shadowHostText("precision-selector", page)).toContain("110 × 90 px");
  const pagesBeforePreview = context.pages().length;
  await clickShadowButton("Preview selected region");
  await expect(page.locator("precision-preview")).toHaveCount(1);
  expect(context.pages()).toHaveLength(pagesBeforePreview);
  const preview = await readShadowCanvas("Captured image, 220 by 180 pixels", page);
  checkFlatPng(preview, 220, 180);
  await clickShadowButton("Close editor");
  await activate("region");
  await page.keyboard.press("Escape");
  await expect(page.locator("precision-selector")).toHaveCount(0);
  await page.locator("#action").click();
  await expect(page.locator("#count")).toHaveText("1");
});

test("selection and preview stay keyboard reachable and expose dialog semantics", async () => {
  await activate();
  await expect(page.locator("precision-selector")).toHaveCount(1);
  expect(await shadowHostIsFocused("precision-selector", page)).toBe(true);
  await page.keyboard.press("Tab");
  expect(await shadowControlIsFocused("Copy selected element", page)).toBe(true);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  expect(await shadowControlIsFocused("Copy selected element", page)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.locator("precision-selector")).toHaveCount(0);

  await activate();
  await select("#solid");
  await expect(page.locator("precision-preview")).toHaveCount(1);
  const ax = await context.newCDPSession(page);
  const tree = await ax.send("Accessibility.getFullAXTree");
  const descriptions = tree.nodes.map((node: { role?: { value?: string }; name?: { value?: string } }) => `${node.role?.value ?? ""}:${node.name?.value ?? ""}`);
  expect(descriptions).toContain("dialog:Screenshot editor");
  expect(descriptions).toContain("button:Copy image");
  expect(descriptions).toContain("button:Download PNG");
  await ax.detach();
  await clickShadowButton("Zoom out (−)");
  expect(await shadowControlIsFocused("Zoom out (−)", page)).toBe(true);
  await page.keyboard.press("Shift+Tab");
  expect(await shadowControlIsFocused("Download PNG", page)).toBe(true);
  await page.keyboard.press("Tab");
  expect(await shadowControlIsFocused("Zoom out (−)", page)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.locator("precision-preview")).toHaveCount(0);
});
test("composition controls remain reachable in a narrow, short editor viewport", async () => {
  const pageTarget = (await browserCDP.send("Target.getTargets")).targetInfos.find((target) => target.url === page.url());
  const { windowId } = await browserCDP.send("Browser.getWindowForTarget", { targetId: pageTarget?.targetId });
  await browserCDP.send("Browser.setWindowBounds", { windowId, bounds: { width: 390, height: 480, windowState: "normal" } });
  await page.goto("http://localhost:4173/index.html");
  await activate("compose");
  const target = await page.locator("#solid").boundingBox();
  expect(target).not.toBeNull();
  await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2);
  await clickShadowButton("Add selected element to composition");
  await clickShadowButton("Compose 1 captured element");
  let editor = context.pages().find((candidate) => candidate.url().includes("editor.html?id="));
  await expect.poll(() => {
    editor = context.pages().find((candidate) => candidate.url().includes("editor.html?id="));
    return !!editor;
  }).toBe(true);
  await editor!.bringToFront();
  const cdp = await context.newCDPSession(editor!);
  type Node = { backendNodeId: number; nodeName?: string; attributes?: string[]; children?: Node[]; shadowRoots?: Node[] };
  const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
  const collect = (node: Node, name: string): Node[] => [
    ...(node.nodeName === name ? [node] : []),
    ...[...(node.children ?? []), ...(node.shadowRoots ?? [])].flatMap((child) => collect(child, name)),
  ];
  const footer = collect(root, "FOOTER").find((node) => node.children?.some((child) => child.nodeName === "DIV" && child.attributes?.includes("actions")));
  const actionButtons = footer ? collect(footer, "BUTTON") : [];
  const footerBox = footer ? (await cdp.send("DOM.getBoxModel", { backendNodeId: footer.backendNodeId })).model.border : [];
  expect(actionButtons.length).toBeGreaterThanOrEqual(4);
  for (const button of actionButtons) {
    const quad = (await cdp.send("DOM.getBoxModel", { backendNodeId: button.backendNodeId })).model.border;
    const left = Math.min(quad[0]!, quad[2]!, quad[4]!, quad[6]!);
    const right = Math.max(quad[0]!, quad[2]!, quad[4]!, quad[6]!);
    expect(right - left).toBeGreaterThan(0);
    expect(left).toBeGreaterThanOrEqual(Math.min(footerBox[0]!, footerBox[6]!) - 1);
    expect(right).toBeLessThanOrEqual(Math.max(footerBox[2]!, footerBox[4]!) + 1);
  }
  await cdp.detach();
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
  // Resize from a vertical-only drag: a bottom-right handle should follow
  // either pointer axis while preserving the captured element's aspect ratio.
  await editor!.mouse.move(corner.x, corner.y + 24 * canvasMetrics.rect.height / canvasMetrics.height);
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

test("annotation geometry, history and export pixels stay stable across zoom", async ({}, info) => {
  await page.locator("#solid").evaluate((el) => {
    (el as HTMLElement).style.cssText = "position:fixed;left:40px;top:140px;width:240px;height:160px;background:rgb(32,128,192);z-index:5";
  });
  await activate("compose");
  const target = await page.locator("#solid").boundingBox();
  expect(target).not.toBeNull();
  await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2);
  await clickShadowButton("Add selected element to composition");
  await clickShadowButton("Compose 1 captured element");
  let editor = context.pages().find((candidate) => candidate.url().includes("editor.html?id="));
  await expect.poll(() => {
    editor = context.pages().find((candidate) => candidate.url().includes("editor.html?id="));
    return !!editor;
  }).toBe(true);
  expect(editor).toBeTruthy();
  await editor!.bringToFront();
  await expect(editor!.locator("precision-composition")).toHaveCount(1);
  const label = "Editable composition with 1 elements";
  await clickShadowButton("Select div, element 1", editor!);
  await editor!.keyboard.press("0");
  if (info.project.name === "chromium") {
    await expect(editor!.locator("precision-composition")).toHaveScreenshot("composition-selected.png", { animations: "disabled", caret: "hide" });
  }

  const draw = async (points: Array<{ x: number; y: number }>) => {
    await centerCanvasPointInViewport(label, points[0]!.x, points[0]!.y, editor!);
    const metrics = await shadowCanvasMetrics(label, editor!);
    const start = canvasClientPoint(metrics, points[0]!.x, points[0]!.y);
    await editor!.mouse.move(start.x, start.y);
    await editor!.mouse.down();
    for (const point of points.slice(1)) {
      const at = canvasClientPoint(metrics, point.x, point.y);
      await editor!.mouse.move(at.x, at.y, { steps: 3 });
    }
    await editor!.mouse.up();
  };
  const pixel = (image: PNG, x: number, y: number) => {
    const offset = (Math.round(y) * image.width + Math.round(x)) * 4;
    return [...image.data.subarray(offset, offset + 4)];
  };
  const redLike = (value: number[]) => value[0]! > value[1]! * 1.3 && value[0]! > value[2]! * 1.25;
  const countGreen = (image: PNG, bounds: { x: number; y: number; width: number; height: number }) => {
    let count = 0;
    for (let y = Math.max(0, Math.floor(bounds.y)); y < Math.min(image.height, Math.ceil(bounds.y + bounds.height)); y++)
      for (let x = Math.max(0, Math.floor(bounds.x)); x < Math.min(image.width, Math.ceil(bounds.x + bounds.width)); x++) {
        const offset = (y * image.width + x) * 4, redChannel = image.data[offset]!, greenChannel = image.data[offset + 1]!, blueChannel = image.data[offset + 2]!;
        if (greenChannel > redChannel * 1.4 && greenChannel > blueChannel * 1.4) count++;
      }
    return count;
  };
  const countRed = (image: PNG, bounds: { x: number; y: number; width: number; height: number }) => {
    let count = 0;
    for (let y = Math.max(0, Math.floor(bounds.y)); y < Math.min(image.height, Math.ceil(bounds.y + bounds.height)); y++)
      for (let x = Math.max(0, Math.floor(bounds.x)); x < Math.min(image.width, Math.ceil(bounds.x + bounds.width)); x++) {
        const offset = (y * image.width + x) * 4, redChannel = image.data[offset]!, greenChannel = image.data[offset + 1]!, blueChannel = image.data[offset + 2]!;
        if (redChannel > greenChannel * 1.3 && redChannel > blueChannel * 1.25) count++;
      }
    return count;
  };
  const redBounds = (image: PNG, area: { x: number; y: number; width: number; height: number }) => {
    let left = image.width, top = image.height, right = -1, bottom = -1;
    for (let y = Math.max(0, Math.floor(area.y)); y < Math.min(image.height, Math.ceil(area.y + area.height)); y++)
      for (let x = Math.max(0, Math.floor(area.x)); x < Math.min(image.width, Math.ceil(area.x + area.width)); x++)
        if (redLike(pixel(image, x, y))) { left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); }
    return { left, top, right, bottom };
  };
  const red: [number, number, number] = [229, 72, 77];

  // Pen: a continuous stroke is one undoable operation at a fitted ~50% view.
  for (let i = 0; i < 3; i++) await clickShadowButton("Zoom out (-)", editor!);
  const halfView = await shadowCanvasMetrics(label, editor!);
  expect(halfView.rect.width / halfView.width).toBeGreaterThan(0.48);
  expect(halfView.rect.width / halfView.width).toBeLessThan(0.55);
  await clickShadowButton("Pen", editor!);
  await draw([{ x: 10, y: 20 }, { x: 25, y: 20 }, { x: 40, y: 20 }]);
  await editor!.keyboard.press("Control+z");
  let current = await readShadowCanvas(label, editor!);
  expect(pixel(current, 25, 20)).toEqual([255, 255, 255, 255]);
  await editor!.keyboard.press("Control+Shift+z");
  current = await readShadowCanvas(label, editor!);
  expect(pixel(current, 25, 20)).toEqual([...red, 255]);
  expect(redLike(pixel(current, 25, 19))).toBe(true);
  expect(redLike(pixel(current, 25, 17))).toBe(false);

  // Select and move the whole stroke; undo/redo restore it as a single gesture.
  await clickShadowButton("Select", editor!);
  await centerCanvasPointInViewport(label, 25, 20, editor!);
  let metrics = await shadowCanvasMetrics(label, editor!);
  const from = canvasClientPoint(metrics, 25, 20), to = canvasClientPoint(metrics, 25, 30);
  await editor!.mouse.move(from.x, from.y);
  await editor!.mouse.down();
  await editor!.mouse.move(to.x, to.y, { steps: 3 });
  await editor!.mouse.up();
  await editor!.keyboard.press("Control+z");
  current = await readShadowCanvas(label, editor!);
  expect(pixel(current, 25, 20)).toEqual([...red, 255]);
  await editor!.keyboard.press("Control+Shift+z");
  current = await readShadowCanvas(label, editor!);
  expect(pixel(current, 25, 30)).toEqual([...red, 255]);

  // Horizontal, short, vertical and diagonal arrows have explicit endpoint checks.
  for (let i = 0; i < 3; i++) await clickShadowButton("Zoom in (+)", editor!);
  await clickShadowButton("Arrow", editor!);
  await draw([{ x: 70, y: 20 }, { x: 115, y: 20 }]);
  await draw([{ x: 140, y: 20 }, { x: 145, y: 20 }]);
  await draw([{ x: 70, y: 60 }, { x: 70, y: 100 }]);
  await draw([{ x: 90, y: 120 }, { x: 120, y: 150 }]);
  current = await readShadowCanvas(label, editor!);
  expect(redLike(pixel(current, 100, 20))).toBe(true);
  expect(redLike(pixel(current, 140, 20))).toBe(true);
  expect(redLike(pixel(current, 70, 90))).toBe(true);
  expect(redLike(pixel(current, 101, 12))).toBe(true);
  expect(redLike(pixel(current, 62, 86))).toBe(true);
  expect(redLike(pixel(current, 78, 86))).toBe(true);
  expect(redLike(pixel(current, 110, 140))).toBe(true);
  expect(pixel(current, 125, 20)).toEqual([255, 255, 255, 255]);

  // Rectangle uses both drag directions and is still stored in image coordinates at ~156%.
  await clickShadowButton("Zoom in (+)", editor!);
  await clickShadowButton("Zoom in (+)", editor!);
  metrics = await shadowCanvasMetrics(label, editor!);
  expect(metrics.rect.width / metrics.width).toBeGreaterThan(1.45);
  expect(metrics.rect.width / metrics.width).toBeLessThan(1.65);
  await clickShadowButton("Rectangle", editor!);
  await draw([{ x: 180, y: 100 }, { x: 140, y: 60 }]);
  current = await readShadowCanvas(label, editor!);
  expect(pixel(current, 160, 60)).toEqual([...red, 255]);
  expect(pixel(current, 140, 80)).toEqual([...red, 255]);
  const originalRectangleBounds = redBounds(current, { x: 125, y: 45, width: 100, height: 100 });

  // Selecting a box exposes four corner handles; resizing changes image-space geometry in one undo step.
  await clickShadowButton("Select", editor!);
  metrics = await shadowCanvasMetrics(label, editor!);
  const resizeCases = [
    { corner: { x: 140, y: 60 }, destination: { x: 130, y: 50 }, left: true, top: true },
    { corner: { x: 180, y: 60 }, destination: { x: 190, y: 50 }, right: true, top: true },
    { corner: { x: 180, y: 100 }, destination: { x: 190, y: 110 }, right: true, bottom: true },
    { corner: { x: 140, y: 100 }, destination: { x: 130, y: 110 }, left: true, bottom: true },
  ];
  let lastResizedBounds = originalRectangleBounds;
  for (const resize of resizeCases) {
    const selectRect = canvasClientPoint(metrics, 160, 80);
    await editor!.mouse.click(selectRect.x, selectRect.y);
    const start = canvasClientPoint(metrics, resize.corner.x, resize.corner.y);
    const end = canvasClientPoint(metrics, resize.destination.x, resize.destination.y);
    await editor!.mouse.move(start.x, start.y);
    await editor!.mouse.down();
    await editor!.mouse.move(end.x, end.y, { steps: 4 });
    await editor!.mouse.up();
    current = await readShadowCanvas(label, editor!);
    lastResizedBounds = redBounds(current, { x: 125, y: 45, width: 100, height: 100 });
    if (resize.left) expect(lastResizedBounds.left).toBeLessThan(originalRectangleBounds.left - 5);
    if (resize.right) expect(lastResizedBounds.right).toBeGreaterThan(originalRectangleBounds.right + 5);
    if (resize.top) expect(lastResizedBounds.top).toBeLessThan(originalRectangleBounds.top - 5);
    if (resize.bottom) expect(lastResizedBounds.bottom).toBeGreaterThan(originalRectangleBounds.bottom + 5);
    await editor!.keyboard.press("Control+z");
    current = await readShadowCanvas(label, editor!);
    expect(redBounds(current, { x: 125, y: 45, width: 100, height: 100 })).toEqual(originalRectangleBounds);
  }
  await editor!.keyboard.press("Control+Shift+z");
  current = await readShadowCanvas(label, editor!);
  expect(redBounds(current, { x: 125, y: 45, width: 100, height: 100 })).toEqual(lastResizedBounds);
  await editor!.keyboard.press("Control+z");

  // At the largest supported editor zoom, pointer geometry remains in image pixels.
  await clickShadowButton("Zoom in (+)", editor!);
  metrics = await shadowCanvasMetrics(label, editor!);
  expect(metrics.rect.width / metrics.width).toBeGreaterThan(1.9);
  expect(metrics.rect.width / metrics.width).toBeLessThan(2.05);
  await clickShadowButton("Pen", editor!);
  await draw([{ x: 200, y: 280 }, { x: 220, y: 280 }]);
  current = await readShadowCanvas(label, editor!);
  expect(redLike(pixel(current, 210, 280))).toBe(true);

  // Browser zoom and editor zoom are separate scales; the same world mapping applies.
  await editor!.bringToFront();
  await worker.evaluate(async () => {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.tabs.setZoom(active!.id!, 1.25);
  });
  await editor!.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await clickShadowButton("Pen", editor!);
  await draw([{ x: 65, y: 70 }, { x: 85, y: 70 }]);

  // Text is edited in place: active input hides the old mark; edit history is chronological even in Select mode.
  await worker.evaluate(async () => {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.tabs.setZoom(active!.id!, 1);
  });
  await editor!.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await clickShadowButton("Text", editor!);
  expect(await shadowAttribute("Text", "aria-pressed", editor!)).toBe("true");
  await setShadowInput("Annotation color", "#e5484d", editor!);
  await draw([{ x: 300, y: 20 }]);
  expect(await shadowAttribute("Type annotation on screenshot", "class", editor!)).toBe("canvas-text-input");
  await editor!.keyboard.type("Old");
  await editor!.keyboard.press("Enter");
  current = await readShadowCanvas(label, editor!);
  expect(countRed(current, { x: 298, y: 17, width: 150, height: 30 })).toBeGreaterThan(0);
  await clickShadowButton("Select", editor!);
  await setShadowInput("Annotation color", "#00aa00", editor!);
  await centerCanvasPointInViewport(label, 310, 25, editor!);
  metrics = await shadowCanvasMetrics(label, editor!);
  const textPoint = canvasClientPoint(metrics, 310, 25);
  await editor!.mouse.click(textPoint.x, textPoint.y);
  await editor!.keyboard.press(selectAllShortcut);
  await editor!.keyboard.type("New text");
  current = await readShadowCanvas(label, editor!);
  expect(countRed(current, { x: 298, y: 17, width: 130, height: 30 })).toBe(0);
  await setShadowInput("Annotation color", "#00aa00", editor!);
  await editor!.keyboard.press("Enter");
  current = await readShadowCanvas(label, editor!);
  expect(countGreen(current, { x: 298, y: 17, width: 150, height: 30 })).toBeGreaterThan(0);
  await clickShadowText("Annotations ·", editor!);
  const accessibility = await context.newCDPSession(editor!);
  const annotationTree = await accessibility.send("Accessibility.getFullAXTree");
  expect(annotationTree.nodes.some((node: { role?: { value?: string }; name?: { value?: string } }) => node.role?.value === "button" && node.name?.value === "Text: New text, at 300, 20")).toBe(true);
  await accessibility.detach();
  await clickShadowButton("Text: New text, at 300, 20", editor!);
  await editor!.keyboard.press(selectAllShortcut);
  await editor!.keyboard.type("Edited from annotation list");
  await editor!.keyboard.press("Enter");
  current = await readShadowCanvas(label, editor!);
  expect(countGreen(current, { x: 298, y: 17, width: 190, height: 30 })).toBeGreaterThan(0);
  await editor!.keyboard.press("Control+z");
  current = await readShadowCanvas(label, editor!);
  expect(countGreen(current, { x: 298, y: 17, width: 150, height: 30 })).toBeGreaterThan(0);
  await editor!.keyboard.press("Control+Shift+z");
  current = await readShadowCanvas(label, editor!);
  expect(countGreen(current, { x: 298, y: 17, width: 190, height: 30 })).toBeGreaterThan(0);

  // Recolor the selected existing text as one undoable operation.
  await clickShadowButton("Select", editor!);
  await centerCanvasPointInViewport(label, 350, 25, editor!);
  metrics = await shadowCanvasMetrics(label, editor!);
  const recolorPoint = canvasClientPoint(metrics, 350, 25);
  await editor!.mouse.click(recolorPoint.x, recolorPoint.y);
  await setShadowInput("Annotation color", "#2255ee", editor!);
  await editor!.keyboard.press("Enter");
  current = await readShadowCanvas(label, editor!);
  const countBlue = (image: PNG) => {
    let count = 0;
    for (let y = 15; y < 48; y++) for (let x = 290; x < 520; x++) {
      const [r, g, b] = pixel(image, x, y);
      if (b! > r! * 1.35 && b! > g! * 1.15) count++;
    }
    return count;
  };
  expect(countBlue(current)).toBeGreaterThan(0);
  await editor!.keyboard.press("Control+z");
  current = await readShadowCanvas(label, editor!);
  expect(countGreen(current, { x: 298, y: 17, width: 190, height: 30 })).toBeGreaterThan(0);
  await editor!.keyboard.press("Control+Shift+z");
  current = await readShadowCanvas(label, editor!);
  expect(countBlue(current)).toBeGreaterThan(0);

  await centerCanvasPointInViewport(label, 310, 25, editor!);
  metrics = await shadowCanvasMetrics(label, editor!);
  const textFrom = canvasClientPoint(metrics, 310, 25), textTo = canvasClientPoint(metrics, 350, 25);
  await editor!.mouse.move(textFrom.x, textFrom.y);
  await editor!.mouse.down();
  await editor!.mouse.move(textTo.x, textTo.y, { steps: 3 });
  await editor!.mouse.up();
  current = await readShadowCanvas(label, editor!);
  expect(countBlue(current)).toBeGreaterThan(0);
  await editor!.keyboard.press("Control+z");
  await editor!.keyboard.press("Control+Shift+z");

  // Empty text creates no mark or history item.
  await clickShadowButton("Text", editor!);
  await draw([{ x: 500, y: 20 }]);
  await editor!.keyboard.press("Enter");
  current = await readShadowCanvas(label, editor!);
  expect(pixel(current, 500, 20)).toEqual([255, 255, 255, 255]);

  // A boundary-crossing spotlight preserves its bright interior; fixed 58% opacity has a stable flat-pixel result.
  for (let i = 0; i < 3; i++) await clickShadowButton("Zoom out (-)", editor!);
  await clickShadowButton("Spotlight", editor!);
  await draw([{ x: 0, y: 0 }, { x: 100, y: 100 }]);
  current = await readShadowCanvas(label, editor!);
  expect(pixel(current, 95, 95)).toEqual([32, 128, 192, 255]);
  expect(pixel(current, 200, 200)).toEqual([23, 64, 93, 255]);
  expect(pixel(current, 70, 70)).toEqual([...red, 255]);
  await draw([{ x: 200, y: 200 }, { x: 250, y: 250 }]);
  current = await readShadowCanvas(label, editor!);
  expect(pixel(current, 95, 95)).toEqual([23, 64, 93, 255]);
  expect(pixel(current, 220, 220)).toEqual([32, 128, 192, 255]);
  await editor!.keyboard.press("Control+z");
  current = await readShadowCanvas(label, editor!);
  expect(pixel(current, 95, 95)).toEqual([32, 128, 192, 255]);
  await editor!.keyboard.press("Control+Shift+z");

  // Download and clipboard are the same decoded image at unchanged world geometry.
  await clickShadowButton("Select", editor!);
  await centerCanvasPointInViewport(label, 550, 20, editor!);
  metrics = await shadowCanvasMetrics(label, editor!);
  const blank = canvasClientPoint(metrics, 550, 20);
  await editor!.mouse.click(blank.x, blank.y);
  const output = await exportComposition(editor!, info.outputPath("editor-precision-annotations.png"));
  expect(pixel(output, 95, 95)).toEqual([23, 64, 93, 255]);
  expect(pixel(output, 220, 220)).toEqual([32, 128, 192, 255]);
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
        if (candidate.width === output.width && candidate.height === output.height) clipboardPng = candidate;
      }
    } catch { /* wait for the browser clipboard to finish publishing the image */ }
    if (!clipboardPng) await editor!.waitForTimeout(100);
  }
  expect(clipboardPng, "clipboard contains the exported PNG dimensions").toBeDefined();
  expect(clipboardPng!.data).toEqual(output.data);
  const closed = editor!.waitForEvent("close");
  const escape = editor!.keyboard.press("Escape").catch(() => undefined);
  await Promise.all([closed, escape]);
});

test("overlapping composition uses topmost hits and chronological history", async ({}, info) => {
  await page.evaluate(() => {
    document.querySelectorAll("#overlap-blue,#overlap-yellow").forEach((element) => element.remove());
    for (const [id, color, left] of [["overlap-blue", "rgb(24,80,220)", "100px"], ["overlap-yellow", "rgb(230,190,30)", "750px"]]) {
      const element = document.createElement("div");
      element.id = id;
      element.style.cssText = `position:fixed;z-index:99999;left:${left};top:500px;width:120px;height:120px;background:${color}`;
      document.body.append(element);
    }
  });
  await activate("compose");
  for (const id of ["#overlap-blue", "#overlap-yellow"]) {
    const box = await page.locator(id).boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await clickShadowButton("Add selected element to composition");
    await expect(page.locator("precision-selector")).toHaveCount(1);
    await page.waitForTimeout(600);
  }
  await clickShadowButton("Compose 2 captured elements");
  let editor = context.pages().find((candidate) => candidate.url().includes("editor.html?id="));
  await expect.poll(() => {
    editor = context.pages().find((candidate) => candidate.url().includes("editor.html?id="));
    return !!editor;
  }).toBe(true);
  expect(editor).toBeTruthy();
  await editor!.bringToFront();
  await expect(editor!.locator("precision-composition")).toHaveCount(1);
  const label = "Editable composition with 2 elements";
  let metrics = await shadowCanvasMetrics(label, editor!);
  expect(metrics.width).toBe(336);
  expect(metrics.height).toBe(604);
  const at = (x: number, y: number) => canvasClientPoint(metrics, x, y);
  let image = await exportComposition(editor!, info.outputPath("overlap-before-move.png"));
  let offset = (436 * image.width + 168) * 4;
  expect([...image.data.subarray(offset, offset + 4)]).toEqual([230, 190, 30, 255]);
  const first = at(168, 436), second = at(168, 168);
  await editor!.mouse.move(first.x, first.y);
  await editor!.mouse.down();
  await editor!.mouse.move(second.x, second.y, { steps: 8 });
  await editor!.mouse.up();

  // The topmost item under an overlap receives the click and drag.
  metrics = await shadowCanvasMetrics(label, editor!);
  const overlap = at(168, 168);
  await editor!.mouse.click(overlap.x, overlap.y);
  expect(await shadowAttribute("Select div, element 2", "aria-pressed", editor!)).toBe("true");
  image = await exportComposition(editor!, info.outputPath("overlap-topmost-yellow.png"));
  expect(image.width).toBe(336);
  expect(image.height).toBe(604);
  const pixel = (x: number, y: number) => {
    const offset = (y * image.width + x) * 4;
    return [...image.data.subarray(offset, offset + 4)];
  };
  expect(pixel(168, 168)).toEqual([230, 190, 30, 255]);

  // A vertical-only resize follows the bottom-right handle and stays aspect locked.
  await clickShadowButton("Select div, element 2", editor!);
  metrics = await shadowCanvasMetrics(label, editor!);
  const handle = Math.max(14, metrics.width / 180);
  const handlePoint = at(48 + 240 - handle / 2, 48 + 240 - handle / 2);
  const resizeTo = { x: handlePoint.x, y: handlePoint.y + 24 * metrics.rect.height / metrics.height };
  await editor!.mouse.move(handlePoint.x, handlePoint.y);
  await editor!.mouse.down();
  await editor!.mouse.move(resizeTo.x, resizeTo.y, { steps: 4 });
  await editor!.mouse.up();
  image = await exportComposition(editor!, info.outputPath("overlap-resized.png"));
  offset = (300 * image.width + 300) * 4;
  expect([...image.data.subarray(offset, offset + 4)]).toEqual([230, 190, 30, 255]);
  await editor!.keyboard.press("Control+z");
  image = await exportComposition(editor!, info.outputPath("overlap-resize-undo.png"));
  offset = (300 * image.width + 300) * 4;
  expect([...image.data.subarray(offset, offset + 4)]).toEqual([255, 255, 255, 255]);
  await editor!.keyboard.press("Control+Shift+z");

  // Reorder changes the visible topmost object, but not its stable selection identity.
  await clickShadowButton("Send backward", editor!);
  expect(await shadowAttribute("Select div, element 1", "aria-pressed", editor!)).toBe("true");
  image = await exportComposition(editor!, info.outputPath("overlap-blue-on-top.png"));
  offset = (168 * image.width + 168) * 4;
  expect([...image.data.subarray(offset, offset + 4)]).toEqual([24, 80, 220, 255]);
  await editor!.keyboard.press("Control+z");
  expect(await shadowAttribute("Select div, element 2", "aria-pressed", editor!)).toBe("true");
  await editor!.keyboard.press("Control+Shift+z");

  // Annotation layers render above every composition object. Removing an object
  // and undoing it must leave the annotation intact; the next undo removes it.
  await clickShadowButton("Rectangle", editor!);
  metrics = await shadowCanvasMetrics(label, editor!);
  const from = at(155, 155), to = at(181, 181);
  await editor!.mouse.move(from.x, from.y);
  await editor!.mouse.down();
  await editor!.mouse.move(to.x, to.y, { steps: 4 });
  await editor!.mouse.up();
  expect(await shadowAttribute("Select div, element 1", "aria-pressed", editor!)).toBe("true");
  await clickShadowButton("Select", editor!);
  metrics = await shadowCanvasMetrics(label, editor!);
  const deleteMarkPoint = at(168, 168);
  await editor!.mouse.click(deleteMarkPoint.x, deleteMarkPoint.y);
  await editor!.keyboard.press("Backspace");
  await expect.poll(() => shadowHostText("precision-composition", editor!)).toContain("Annotation removed");
  image = await exportComposition(editor!, info.outputPath("overlap-annotation-backspace.png"));
  expect([...image.data.subarray((155 * image.width + 168) * 4, (155 * image.width + 168) * 4 + 4)]).toEqual([24, 80, 220, 255]);
  await expect.poll(() => shadowHostText("precision-composition", editor!)).toContain("Elements · 2");
  await editor!.keyboard.press("Control+z");
  image = await exportComposition(editor!, info.outputPath("overlap-annotation-backspace-undo.png"));
  offset = (155 * image.width + 168) * 4;
  expect(image.data[offset]).toBeGreaterThan(180);
  await clickShadowButton("Select div, element 2", editor!);
  await clickShadowButton("Remove", editor!);
  image = await exportComposition(editor!, info.outputPath("overlap-after-remove.png"));
  offset = (155 * image.width + 168) * 4;
  expect(image.data[offset]).toBeGreaterThan(180);
  expect(image.data[offset + 1]).toBeLessThan(120);
  await editor!.keyboard.press("Control+z");
  image = await exportComposition(editor!, info.outputPath("overlap-remove-undo.png"));
  offset = (155 * image.width + 168) * 4;
  expect(image.data[offset]).toBeGreaterThan(180);
  await editor!.keyboard.press("Control+z");
  image = await exportComposition(editor!, info.outputPath("overlap-annotation-undo.png"));
  offset = (155 * image.width + 168) * 4;
  expect([...image.data.subarray(offset, offset + 4)]).toEqual([24, 80, 220, 255]);
  await editor!.keyboard.press("Control+Shift+z");
  image = await exportComposition(editor!, info.outputPath("overlap-annotation-redo.png"));
  offset = (155 * image.width + 168) * 4;
  expect(image.data[offset]).toBeGreaterThan(180);
  await clickShadowButton("Select div, element 2", editor!);
  await editor!.keyboard.press("Delete");
  await expect.poll(() => shadowHostText("precision-composition", editor!)).toContain("Elements · 1");
  await editor!.keyboard.press("Control+z");
  await expect.poll(() => shadowHostText("precision-composition", editor!)).toContain("Elements · 2");
  const closed = editor!.waitForEvent("close");
  const escape = editor!.keyboard.press("Escape").catch(() => undefined);
  await Promise.all([closed, escape]);
});

test("solid redaction and native window frame are preserved in the exported PNG", async ({}, info) => {
  await page.locator("#solid").evaluate((el) => {
    (el as HTMLElement).style.cssText = "position:fixed;left:40px;top:140px;width:240px;height:160px;background:repeating-linear-gradient(90deg,rgb(32,128,192) 0 2px,white 2px 4px);z-index:5";
  });
  await activate("compose");
  const target = await page.locator("#solid").boundingBox();
  expect(target).not.toBeNull();
  await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2);
  await clickShadowButton("Add selected element to composition");
  await clickShadowButton("Compose 1 captured element");
  let editor = context.pages().find((candidate) => candidate.url().includes("editor.html?id="));
  await expect.poll(() => {
    editor = context.pages().find((candidate) => candidate.url().includes("editor.html?id="));
    return !!editor;
  }).toBe(true);
  await editor!.bringToFront();
  await expect(editor!.locator("precision-composition")).toHaveCount(1);
  const label = "Editable composition with 1 elements";
  await clickShadowButton("Mask", editor!);
  await setShadowInput("Annotation color", "#3344dd", editor!);
  await centerCanvasPointInViewport(label, 70, 65, editor!);
  let metrics = await shadowCanvasMetrics(label, editor!);
  let start = canvasClientPoint(metrics, 60, 58), end = canvasClientPoint(metrics, 110, 88);
  await editor!.mouse.move(start.x, start.y);
  await editor!.mouse.down();
  await editor!.mouse.move(end.x, end.y, { steps: 3 });
  await editor!.mouse.up();
  const unblurred = await readShadowCanvas(label, editor!);
  const baselineOffset = (70 * unblurred.width + 200) * 4;
  const baselinePixel = [...unblurred.data.subarray(baselineOffset, baselineOffset + 3)];
  await clickShadowButton("Blur", editor!);
  await setShadowInput("Annotation color", "#22aa44", editor!);
  await centerCanvasPointInViewport(label, 200, 70, editor!);
  metrics = await shadowCanvasMetrics(label, editor!);
  start = canvasClientPoint(metrics, 150, 58);
  end = canvasClientPoint(metrics, 250, 88);
  await editor!.mouse.move(start.x, start.y);
  await editor!.mouse.down();
  await editor!.mouse.move(end.x, end.y, { steps: 3 });
  await editor!.mouse.up();
  await clickShadowButton("Choose screenshot window frame", editor!);
  await clickShadowButton("Frame: Mac", editor!);
  await clickShadowButton("Show capture date and time in screenshot", editor!);
  await expect.poll(async () => shadowAttribute("Show page URL in screenshot frame", "aria-pressed", editor!)).toBe("true");
  await editor!.screenshot({ path: info.outputPath("window-frame-editor-review.png") });
  const image = await exportComposition(editor!, info.outputPath("framed-masked-composition.png"));
  expect(image.width).toBe(metrics.width + 32);
  expect(image.height).toBe(metrics.height + 88);
  const pixel = (x: number, y: number) => [...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];
  let timeInk = 0;
  for (let y = 16; y < 72; y++) for (let x = Math.max(0, image.width - 320); x < image.width - 20; x++) {
    const [red, green, blue] = pixel(x, y);
    if (red! < 130 && green! < 140 && blue! < 150) timeInk++;
  }
  expect(timeInk).toBeGreaterThan(40);
  expect(pixel(16 + 75, 16 + 56 + 68)).toEqual([51, 68, 221, 255]);
  expect(pixel(16 + 120, 16 + 56 + 100)).not.toEqual([51, 68, 221, 255]);
  const blurredPixel = pixel(16 + 200, 16 + 56 + 70).slice(0, 3);
  expect(blurredPixel.some((channel, index) => Math.abs(channel - baselinePixel[index]!) > 10)).toBe(true);
  expect(blurredPixel[1]).toBeGreaterThan(blurredPixel[0]!);
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
  const sourceWidth = Number(dimensions![1]), sourceHeight = Number(dimensions![2]);
  await clickShadowButton("Choose screenshot window frame", editor!);
  await clickShadowButton("Frame: Windows", editor!);
  await expect.poll(async () => shadowAttribute("Show page URL in screenshot frame", "aria-pressed", editor!)).toBe("true");
  const framedDownload = editor!.waitForEvent("download");
  await clickShadowButton("Download PNG", editor!);
  const framedFile = await framedDownload;
  const framedPath = await framedFile.path();
  expect(framedPath).toBeTruthy();
  const framedPng = PNG.sync.read(await readFile(framedPath!));
  const inset = Math.max(16, Math.round(Math.min(sourceWidth, sourceHeight) * 0.025));
  const bar = Math.max(56, Math.min(112, Math.round(sourceWidth * 0.035)));
  expect(framedPng.width).toBe(sourceWidth + inset * 2);
  expect(framedPng.height).toBe(sourceHeight + inset + bar);
  let urlInk = 0;
  for (let y = inset + Math.floor(bar * 0.2); y < inset + Math.ceil(bar * 0.8); y++) {
    for (let x = inset + 24; x < Math.min(framedPng.width - inset - 100, inset + 500); x++) {
      const offset = (y * framedPng.width + x) * 4;
      if (framedPng.data[offset]! < 130 && framedPng.data[offset + 1]! < 140 && framedPng.data[offset + 2]! < 150) urlInk++;
    }
  }
  expect(urlInk).toBeGreaterThan(40);
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

test("full-page startup timeout restores popup controls when the browser tab lookup stalls", async () => {
  await worker.evaluate(() => {
    Object.defineProperty(chrome.tabs, "get", {
      configurable: true,
      value: () => new Promise(() => {}),
    });
  });
  await activate("fullPage", true, "Precision could not start capture on this page.");
  await expect(page.locator("precision-full-page-progress")).toHaveCount(0);
});

test("popup restores capture controls when the background worker never responds", async () => {
  const popup = await context.newPage();
  try {
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.evaluate(() => {
      const nativeSetTimeout = window.setTimeout.bind(window);
      window.setTimeout = ((callback: TimerHandler) =>
        nativeSetTimeout(callback, 25)) as typeof window.setTimeout;
      Object.defineProperty(chrome.runtime, "sendMessage", {
        configurable: true,
        value: () => new Promise(() => {}),
      });
    });
    const button = popup.locator('button[data-mode="visible"]');
    await button.click();
    await expect(popup.locator("#status")).toContainText(
      "could not connect to its background worker",
    );
    await expect(button).toBeEnabled();
  } finally {
    await popup.close();
  }
});

test("full-page capture settles a lazy image and documents fixed/nested content", async ({}, info) => {
  const startedAt = Date.now();
  await page.goto("http://localhost:4173/full-page-edge.html");
  await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.tabs.setZoom(tab!.id!, 1.25);
  });
  await page.evaluate(() => window.scrollTo(0, 120));
  const before = await page.evaluate(() => ({
    x: scrollX,
    y: scrollY,
    width: innerWidth,
    height: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
    zoom: visualViewport!.scale,
  }));
  expect(await page.locator(".lazy-image").evaluate((image: HTMLImageElement) => image.currentSrc)).toBe("");
  const lazyRect = await page.locator(".lazy-image").boundingBox();
  expect(lazyRect).not.toBeNull();

  await activate("fullPage");
  let editor = context.pages().find((candidate) => candidate.url().includes("editor.html?id="));
  await expect.poll(() => {
    editor = context.pages().find((candidate) => candidate.url().includes("editor.html?id="));
    return !!editor;
  }).toBe(true);
  await editor!.bringToFront();
  const downloaded = await exportComposition(editor!, info.outputPath("full-page-lazy.png"));
  const pngBytes = (await readFile(info.outputPath("full-page-lazy.png"))).byteLength;
  console.log("Full-page fixture measurement", { pngWidth: downloaded.width, pngHeight: downloaded.height, decodedRgbaBytes: downloaded.data.byteLength, pngBytes, elapsedMs: Date.now() - startedAt });
  const scale = downloaded.width / before.width;
  expect(scale).toBeGreaterThan(2.4);
  expect(scale).toBeLessThan(2.6);
  expect(downloaded.height).toBeGreaterThan(before.height * scale - 8);
  const pixel = (x: number, y: number) => {
    const offset = (Math.floor(y) * downloaded.width + Math.floor(x)) * 4;
    return [...downloaded.data.subarray(offset, offset + 4)];
  };
  const sample = (x: number, y: number) => pixel(x * scale, y * scale).slice(0, 3);
  expect(sample(300, 400)).toEqual([36, 104, 160]);
  expect(sample(300, 900)).toEqual([163, 62, 70]);
  expect(sample(800, 1600)).toEqual([52, 130, 91]);
  expect(sample(800, 2200)).toEqual([165, 121, 34]);
  expect(sample(lazyRect!.x + lazyRect!.width / 2, lazyRect!.y + before.y + lazyRect!.height / 2)).toEqual([255, 0, 255]);
  // The captured view includes only the visible portion of the nested scroller.
  let unseenNestedPurplePixels = 0;
  for (let y = 0; y < downloaded.height; y++) for (let x = 0; x < downloaded.width; x++) {
    const offset = (y * downloaded.width + x) * 4;
    if (downloaded.data[offset] === 155 && downloaded.data[offset + 1] === 89 && downloaded.data[offset + 2] === 182)
      unseenNestedPurplePixels++;
  }
  expect(unseenNestedPurplePixels).toBe(0);
  let fixedBarRuns = 0, insideFixedBar = false;
  for (let y = 0; y < downloaded.height; y++) {
    const offset = (y * downloaded.width + Math.floor(10 * scale)) * 4;
    const isFixedBar = downloaded.data[offset] === 0 && downloaded.data[offset + 1] === 201 && downloaded.data[offset + 2] === 183;
    if (isFixedBar && !insideFixedBar) fixedBarRuns++;
    insideFixedBar = isFixedBar;
  }
  expect(fixedBarRuns).toBeGreaterThan(1);
  expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual({ x: before.x, y: before.y });
  const closed = editor!.waitForEvent("close");
  const close = clickShadowButton("Close editor", editor!).catch(() => undefined);
  await Promise.all([closed, close]);
});

test("full-page rejects changing height and recovers on a stable retry", async ({}, info) => {
  await page.goto("http://localhost:4173/full-page-edge.html?case=dynamic");
  await page.evaluate(() => window.scrollTo(0, 120));
  const originalY = await page.evaluate(() => scrollY);
  await expect(activate("fullPage")).rejects.toThrow(/page layout changed/i);
  await expect(page.locator("precision-error")).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(originalY);
  expect(await page.evaluate(() => (window as Window & { __precisionDynamicHeightChanged?: boolean }).__precisionDynamicHeightChanged)).toBe(true);

  await clickShadowText("Dismiss");
  await page.evaluate(() => document.querySelector("#dynamic-band")?.remove());
  await activate("fullPage");
  let editor = context.pages().find((candidate) => candidate.url().includes("editor.html?id="));
  await expect.poll(() => {
    editor = context.pages().find((candidate) => candidate.url().includes("editor.html?id="));
    return !!editor;
  }).toBe(true);
  await editor!.bringToFront();
  const image = await exportComposition(editor!, info.outputPath("full-page-stable-retry.png"));
  expect(image.height).toBeGreaterThan(0);
  const closed = editor!.waitForEvent("close");
  const close = clickShadowButton("Close editor", editor!).catch(() => undefined);
  await Promise.all([closed, close]);
});

test("full-page rejects oversized output before allocating a tall stitch canvas", async () => {
  await page.goto("http://localhost:4173/full-page-edge.html?case=oversize");
  await page.locator("main").evaluate((main) => { (main as HTMLElement).style.height = "20000px"; });
  const originalY = await page.evaluate(() => scrollY);
  await expect(activate("fullPage")).rejects.toThrow(/too large to capture safely/i);
  await expect(page.locator("precision-error")).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(originalY);
  await expect.poll(async () => (await browserCDP.send("Target.getTargets")).targetInfos.some((target) => target.url.startsWith(`chrome-extension://${id}/editor.html?id=`))).toBe(false);
});

test("near-limit full-page capture records de-duplicated browser memory footprint", async ({}, info) => {
  test.skip(info.project.name !== "chromium" || process.platform !== "darwin", "Uses macOS footprint with bundled Chromium only");
  await page.goto("http://localhost:4173/full-page-edge.html");
  await page.locator("main").evaluate((main) => { (main as HTMLElement).style.height = "8100px"; });
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, documentHeight: document.documentElement.scrollHeight }));
  const startedAt = Date.now();
  const footprintPath = info.outputPath("near-limit-footprint.json");
  const sampler = await startMacFootprintSampler(footprintPath);
  let editor = context.pages().find((candidate) => candidate.url().includes("editor.html?id="));
  let image: PNG;
  let captureAndExportMs: number;
  try {
    await activate("fullPage", false);
    await expect.poll(async () => {
      editor = context.pages().find((candidate) => candidate.url().includes("editor.html?id="));
      return !!editor || await page.locator("precision-error").count() > 0;
    }, { timeout: 45_000, intervals: [100, 250, 500] }).toBe(true);
    await expect(page.locator("precision-error")).toHaveCount(0);
    await editor!.bringToFront();
    image = await exportComposition(editor!, info.outputPath("near-limit-full-page.png"));
    captureAndExportMs = Date.now() - startedAt;
  } finally {
    await sampler.completion;
  }
  const footprint = JSON.parse(await readFile(footprintPath, "utf8")) as { samples?: Array<{ "total footprint"?: number }> };
  const sampledBytes = (footprint.samples ?? []).map((sample) => sample["total footprint"] ?? 0);
  expect(sampledBytes.length).toBeGreaterThan(0);
  const pngBytes = (await readFile(info.outputPath("near-limit-full-page.png"))).byteLength;
  const megapixels = image!.width * image!.height / 1_000_000;
  expect(megapixels).toBeGreaterThan(38);
  expect(megapixels).toBeLessThanOrEqual(40);
  expect(image!.width).toBeGreaterThan(0);
  expect(image!.height).toBeGreaterThan(0);
  console.log("Near-limit full-page measurement", {
    viewport, pngWidth: image!.width, pngHeight: image!.height, megapixels: Number(megapixels.toFixed(2)),
    decodedRgbaBytes: image!.data.byteLength, pngBytes, browserRootPid: sampler.pid,
    footprintScope: "macOS de-duplicated footprint for Playwright Chromium and descendants",
    peakFootprintMiB: Number((Math.max(...sampledBytes) / (1024 * 1024)).toFixed(1)),
    footprintSamples: sampledBytes.length, captureAndExportMs,
  });
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
test("full-page cancellation on tab switch restores the page and permits a fresh capture", async ({}, info) => {
  await page.goto("http://localhost:4173/full-page-edge.html");
  await page.evaluate(() => window.scrollTo(0, 100));
  const originalY = await page.evaluate(() => scrollY);
  await activate("fullPage", false);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(originalY);
  const otherTab = await context.newPage();
  await otherTab.goto("http://localhost:4173/index.html");
  await expect(page.locator("precision-full-page-progress")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(originalY);
  await otherTab.close();
  await page.bringToFront();
  await activate("fullPage");
  let editor = context.pages().find((candidate) => candidate.url().includes("editor.html?id="));
  await expect.poll(() => {
    editor = context.pages().find((candidate) => candidate.url().includes("editor.html?id="));
    return !!editor;
  }).toBe(true);
  await editor!.bringToFront();
  const image = await exportComposition(editor!, info.outputPath("full-page-after-tab-switch.png"));
  expect(image.width).toBeGreaterThan(0);
  expect(image.height).toBeGreaterThan(0);
});

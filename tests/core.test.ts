import { describe, it, expect, beforeEach, vi } from "vitest";
import { intersect, cropPixels, rectFromPoints, resizeRectFromCorner, validRect } from "../src/shared/geometry";
import { isCapture } from "../src/shared/protocol";
import { transition } from "../src/shared/session";
import { isSupportedPageUrl } from "../src/shared/page-url";
import { withTimeout } from "../src/shared/timeout";
import { canvasToClientPoint, clientToCanvasPoint, resizedAspectWidth } from "../src/shared/editor-geometry";
import { bounds, parentTarget, childTarget, targetAt } from "../src/target";
import { captureWithTransientRetry } from "../src/shared/capture-retry";
describe("transient viewport screenshot recovery", () => {
  it("retries Chromium's internal screenshot error once after checking the tab", async () => {
    const capture = vi.fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("Internal error."))
      .mockResolvedValueOnce("image/png");
    const beforeRetry = vi.fn().mockResolvedValue(undefined);
    const wait = vi.fn().mockResolvedValue(undefined);
    await expect(captureWithTransientRetry(capture, beforeRetry, wait)).resolves.toBe("image/png");
    expect(capture).toHaveBeenCalledTimes(2);
    expect(beforeRetry).toHaveBeenCalledOnce();
    expect(wait).toHaveBeenCalledWith(650);
  });
  it("does not retry permanent or permission errors", async () => {
    const capture = vi.fn<() => Promise<string>>().mockRejectedValue(new Error("Permission denied."));
    const beforeRetry = vi.fn();
    await expect(captureWithTransientRetry(capture, beforeRetry)).rejects.toThrow("Permission denied.");
    expect(capture).toHaveBeenCalledOnce();
    expect(beforeRetry).not.toHaveBeenCalled();
  });
  it("returns actionable guidance when the browser fails again", async () => {
    const capture = vi.fn<() => Promise<string>>().mockRejectedValue(new Error("Internal error."));
    await expect(captureWithTransientRetry(capture, async () => {}, async () => {})).rejects.toThrow(
      "Your browser could not capture this page after retry.",
    );
    expect(capture).toHaveBeenCalledTimes(2);
  });
});
const viewport = { width: 800, height: 600, scrollX: 0, scrollY: 0 };
describe("startup timeout", () => {
  it("returns the operation result before the deadline", async () => {
    await expect(withTimeout(Promise.resolve("started"), 100, "timed out")).resolves.toBe("started");
  });

  it("rejects when extension startup stops responding", async () => {
    vi.useFakeTimers();
    try {
      const result = withTimeout(new Promise<never>(() => {}), 15000, "startup timed out");
      const expectation = expect(result).rejects.toThrow("startup timed out");
      await vi.advanceTimersByTimeAsync(15000);
      await expectation;
    } finally {
      vi.useRealTimers();
    }
  });
});
describe("geometry", () => {
  it("normalizes custom region drags in either direction", () => {
    expect(rectFromPoints({ x: 120.5, y: 90.25 }, { x: 20.25, y: 10.5 })).toEqual({
      x: 20.25,
      y: 10.5,
      width: 100.25,
      height: 79.75,
    });
  });
  it.each([
    ["nw", { x: 30, y: 25 }, { x: 30, y: 25, width: 90, height: 75 }],
    ["ne", { x: 130, y: 25 }, { x: 20, y: 25, width: 110, height: 75 }],
    ["sw", { x: 30, y: 105 }, { x: 30, y: 20, width: 90, height: 85 }],
    ["se", { x: 130, y: 105 }, { x: 20, y: 20, width: 110, height: 85 }],
  ] as const)("resizes from %s while preserving the opposite corner", (corner, point, expected) => {
    expect(resizeRectFromCorner({ x: 20, y: 20, width: 100, height: 80 }, corner, point, { x: 0, y: 0, width: 200, height: 200 })).toEqual(expected);
  });
  it("clamps resize handles to the viewport and prevents crossing the anchor", () => {
    const rect = { x: 20, y: 20, width: 100, height: 80 };
    const bounds = { x: 0, y: 0, width: 200, height: 200 };
    expect(resizeRectFromCorner(rect, "nw", { x: 190, y: 190 }, bounds)).toEqual({ x: 118, y: 98, width: 2, height: 2 });
    expect(resizeRectFromCorner(rect, "se", { x: -20, y: -20 }, bounds)).toEqual({ x: 20, y: 20, width: 2, height: 2 });
    expect(resizeRectFromCorner(rect, "se", { x: 300, y: 300 }, bounds)).toEqual({ x: 20, y: 20, width: 180, height: 180 });
  });
  it("retains fractional visual viewport precision at 125% zoom", () => {
    expect(
      cropPixels(
        { x: 40, y: 140, width: 240, height: 160 },
        { width: 960, height: 650.4000244140625, scrollX: 0, scrollY: 0 },
        2400,
        1626,
      ),
    ).toEqual({ x: 100, y: 350, width: 600, height: 400 });
  });
  it("clips all edges", () =>
    expect(
      intersect(
        { x: -20, y: 580, width: 850, height: 50 },
        { x: 0, y: 0, width: 800, height: 600 },
      ),
    ).toEqual({ x: 0, y: 580, width: 800, height: 20 }));
  it.each([1, 1.25, 1.5, 2])("uses measured bitmap scale %s", (scale) =>
    expect(
      cropPixels(
        { x: 20, y: 40, width: 100, height: 80 },
        viewport,
        800 * scale,
        600 * scale,
      ),
    ).toEqual({
      x: 20 * scale,
      y: 40 * scale,
      width: 100 * scale,
      height: 80 * scale,
    }),
  );
  it("rounds inward on fractional edges", () =>
    expect(
      cropPixels(
        { x: 1.2, y: 2.3, width: 10.4, height: 10.4 },
        viewport,
        1000,
        750,
      ),
    ).toEqual({ x: 2, y: 3, width: 12, height: 12 }));
  it("handles independent axis scales", () =>
    expect(
      cropPixels({ x: 10, y: 10, width: 20, height: 20 }, viewport, 1600, 900),
    ).toEqual({ x: 20, y: 15, width: 40, height: 30 }));
  it.each([
    { x: 0, y: 0, width: 0, height: 2 },
    { x: NaN, y: 0, width: 2, height: 2 },
    { x: 0, y: 0, width: 2, height: Infinity },
  ])("rejects invalid rectangles", (r) => expect(validRect(r)).toBe(false));
  it("rejects invisible and empty pixel selections", () => {
    expect(() =>
      cropPixels({ x: 900, y: 0, width: 20, height: 20 }, viewport, 800, 600),
    ).toThrow();
    expect(() =>
      cropPixels(
        { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
        viewport,
        800,
        600,
      ),
    ).toThrow();
  });
  it("caps bitmap memory", () =>
    expect(() =>
      cropPixels({ x: 0, y: 0, width: 10, height: 10 }, viewport, 10000, 10000),
    ).toThrow());
});
describe("editor world coordinates", () => {
  it.each([0.5, 1, 1.5, 2])("round-trips pointer coordinates at display scale %s", (scale) => {
    const rect = { left: 17.25, top: 31.5, width: 640 * scale, height: 360 * scale };
    const world = { x: 123.75, y: 271.5 };
    const client = canvasToClientPoint(world, rect, 640, 360)!;
    expect(clientToCanvasPoint(client.x, client.y, rect, 640, 360)).toEqual(world);
  });
  it("clamps client positions to the canvas edge", () => {
    expect(clientToCanvasPoint(-100, 900, { left: 10, top: 20, width: 200, height: 100 }, 400, 200)).toEqual({ x: 0, y: 200 });
  });
  it("rejects degenerate transforms", () => {
    expect(clientToCanvasPoint(1, 2, { left: 0, top: 0, width: 0, height: 20 }, 40, 20)).toBeNull();
    expect(canvasToClientPoint({ x: NaN, y: 0 }, { left: 0, top: 0, width: 10, height: 10 }, 10, 10)).toBeNull();
  });
  it("uses vertical or horizontal movement for aspect-locked resize", () => {
    expect(resizedAspectWidth(120, 2, 0, 20, 400)).toBe(160);
    expect(resizedAspectWidth(120, 2, 20, 0, 400)).toBe(140);
    expect(resizedAspectWidth(120, 2, 20, 10, 400)).toBe(140);
  });
  it("keeps aspect-resize within its canvas bounds and minimum", () => {
    expect(resizedAspectWidth(120, 2, 500, 0, 150)).toBe(150);
    expect(resizedAspectWidth(120, 2, -500, 0, 150)).toBe(32);
  });
});
describe("protocol", () => {
  const good = {
    type: "capture",
    delivery: "preview",
    session: "12345678-1234-1234-1234-123456789abc",
    rect: { x: 0, y: 0, width: 20, height: 20 },
    viewport,
  };
  it("accepts bounded geometry", () => expect(isCapture(good)).toBe(true));
  it.each([
    null,
    {},
    { ...good, session: "bad" },
    { ...good, delivery: "upload" },
    { ...good, viewport: { ...viewport, width: Infinity } },
    { ...good, rect: { ...good.rect, height: -1 } },
  ])("rejects malformed input", (value) =>
    expect(isCapture(value)).toBe(false),
  );
});
describe("session transitions", () => {
  it("allows one capture", () => {
    expect(transition("selecting", "capturing")).toBe("capturing");
    expect(transition("capturing", "complete")).toBe("complete");
    expect(() => transition("capturing", "capturing")).toThrow();
  });
  it("cancellation is terminal", () => {
    expect(transition("capturing", "cancelled")).toBe("cancelled");
    expect(() => transition("cancelled", "complete")).toThrow();
  });
});
describe("supported page URLs", () => {
  it.each([
    "https://example.com/article",
    "http://localhost:3000/",
    "https://chromewebstore.google.com.attacker.test/",
    "https://notchrome.google.com/webstore",
  ])("allows regular web URL %s", (url) =>
    expect(isSupportedPageUrl(url)).toBe(true),
  );
  it.each([
    "chrome://settings/",
    "file:///tmp/page.html",
    "javascript:alert(1)",
    "not a URL",
    "https://chromewebstore.google.com/detail/example",
    "https://chrome.google.com/webstore/detail/example",
    "https://chrome.google.com/webstore",
  ])("rejects unsupported URL %s", (url) =>
    expect(isSupportedPageUrl(url)).toBe(false),
  );
});
describe("DOM navigation", () => {
  beforeEach(() => {
    document.body.replaceChildren();
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      x: 20,
      y: 20,
      width: 100,
      height: 50,
      top: 20,
      left: 20,
      right: 120,
      bottom: 70,
      toJSON: () => ({}),
    });
  });
  it("chooses direct first visible child and parent", () => {
    const p = document.createElement("article"),
      c = document.createElement("p");
    p.append(c);
    document.body.append(p);
    expect(childTarget(p)).toBe(c);
    expect(parentTarget(c)).toBe(p);
  });
  it("skips hidden children", () => {
    const p = document.createElement("div"),
      a = document.createElement("span"),
      b = document.createElement("p");
    a.style.visibility = "hidden";
    p.append(a, b);
    document.body.append(p);
    expect(childTarget(p)).toBe(b);
  });
  it("crosses open shadow roots", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = host.attachShadow({ mode: "open" }),
      child = document.createElement("button");
    root.append(child);
    expect(parentTarget(child)).toBe(host);
    expect(childTarget(host)).toBe(child);
  });
  it("rejects detached elements", () =>
    expect(bounds(document.createElement("div"))).toBeNull());
  it("promotes a control glyph to its button", () => {
    const button = document.createElement("button"),
      span = document.createElement("span");
    button.append(span);
    document.body.append(button);
    Object.defineProperty(document, "elementFromPoint", {
      value: () => span,
      configurable: true,
    });
    expect(targetAt(30, 30)).toBe(button);
  });
});

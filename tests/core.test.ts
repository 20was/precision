import { describe, it, expect, beforeEach, vi } from "vitest";
import { intersect, cropPixels, validRect } from "../src/shared/geometry";
import { isCapture } from "../src/shared/protocol";
import { transition } from "../src/shared/session";
import { bounds, parentTarget, childTarget, targetAt } from "../src/target";
const viewport = { width: 800, height: 600, scrollX: 0, scrollY: 0 };
describe("geometry", () => {
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

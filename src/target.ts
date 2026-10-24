import { intersect, type Rect } from "./shared/geometry";
export function parentOf(el: Element): Element | null {
  return (
    el.parentElement ??
    (el.getRootNode() instanceof ShadowRoot
      ? (el.getRootNode() as ShadowRoot).host
      : null)
  );
}
export function bounds(el: Element): Rect | null {
  if (!el.isConnected || getComputedStyle(el).visibility === "hidden")
    return null;
  const r = el.getBoundingClientRect();
  let result = intersect(
    { x: r.x, y: r.y, width: r.width, height: r.height },
    { x: 0, y: 0, width: innerWidth, height: innerHeight },
  );
  for (let p = parentOf(el); p && result; p = parentOf(p)) {
    const style = getComputedStyle(p),
      b = p.getBoundingClientRect();
    // Rectangular overflow only. A transformed ancestor's padding box is an approximation.
    const clipX = /(hidden|clip|scroll|auto)/.test(style.overflowX),
      clipY = /(hidden|clip|scroll|auto)/.test(style.overflowY);
    if (clipX || clipY)
      result = intersect(result, {
        x: clipX ? b.x + p.clientLeft : result.x,
        y: clipY ? b.y + p.clientTop : result.y,
        width: clipX ? p.clientWidth : result.width,
        height: clipY ? p.clientHeight : result.height,
      });
  }
  return result;
}
export function useful(el: Element): boolean {
  return (
    !["HTML", "SCRIPT", "STYLE", "HEAD", "META", "LINK"].includes(el.tagName) &&
    bounds(el) !== null
  );
}
export function targetAt(x: number, y: number): Element | null {
  let el = document.elementFromPoint(x, y);
  for (let depth = 0; el?.shadowRoot && depth < 32; depth++) {
    const child = el.shadowRoot.elementFromPoint(x, y);
    if (!child || child === el) break;
    el = child;
  }
  if (!el) return null;
  // Icons/text inside controls should select the clickable control, not its tiny glyph.
  let p: Element | null = el;
  for (let depth = 0; p && depth < 6; depth++, p = parentOf(p))
    if (p.matches('button,a,[role="button"],input,textarea,select'))
      return useful(p) ? p : null;
  return useful(el) ? el : null;
}
export function parentTarget(el: Element): Element | null {
  for (let p = parentOf(el); p; p = parentOf(p)) if (useful(p)) return p;
  return null;
}
export function childTarget(el: Element): Element | null {
  return (
    Array.from(el.shadowRoot?.children ?? el.children).find(useful) ?? null
  );
}

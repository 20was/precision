export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Point {
  x: number;
  y: number;
}
export function rectFromPoints(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}
export interface Viewport {
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
}
export function validRect(value: unknown): value is Rect {
  if (!value || typeof value !== "object") return false;
  const r = value as Rect;
  return (
    [r.x, r.y, r.width, r.height].every(Number.isFinite) &&
    r.width > 0 &&
    r.height > 0 &&
    Math.max(Math.abs(r.x), Math.abs(r.y), r.width, r.height) <= 10_000_000
  );
}
export function intersect(a: Rect, b: Rect): Rect | null {
  if (!validRect(a) || !validRect(b)) return null;
  const x = Math.max(a.x, b.x),
    y = Math.max(a.y, b.y);
  const width = Math.min(a.x + a.width, b.x + b.width) - x,
    height = Math.min(a.y + a.height, b.y + b.height) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}
export function cropPixels(
  rect: Rect,
  viewport: Viewport,
  width: number,
  height: number,
): Rect {
  if (
    ![width, height, viewport.width, viewport.height].every(
      (n) => Number.isFinite(n) && n > 0,
    ) ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width * height > 40_000_000
  )
    throw new Error(
      "Screenshot size is unsupported. Use a smaller browser window.",
    );
  const clipped = intersect(rect, {
    x: 0,
    y: 0,
    width: viewport.width,
    height: viewport.height,
  });
  if (!clipped) throw new Error("The element is no longer visible.");
  const sx = width / viewport.width,
    sy = height / viewport.height,
    epsilon = 1e-4;
  const x = Math.ceil(clipped.x * sx - epsilon),
    y = Math.ceil(clipped.y * sy - epsilon);
  const right = Math.floor((clipped.x + clipped.width) * sx + epsilon),
    bottom = Math.floor((clipped.y + clipped.height) * sy + epsilon);
  if (right <= x || bottom <= y)
    throw new Error("The visible selection is too small to capture.");
  return { x, y, width: right - x, height: bottom - y };
}
export function sameGeometry(a: Rect, b: Rect): boolean {
  return (["x", "y", "width", "height"] as const).every(
    (k) => Math.abs(a[k] - b[k]) < 0.05,
  );
}

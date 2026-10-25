import { validRect, type Rect, type Viewport } from "./geometry";
export interface CaptureMessage {
  type: "capture";
  session: string;
  rect: Rect;
  viewport: Viewport;
  delivery: "preview" | "copy" | "composeItem";
}
export type StartMode = "element" | "region" | "visible" | "fullPage" | "compose";
export type Result<T = undefined> =
  { ok: true; value: T } | { ok: false; error: string };
export const failure = (error: unknown): Result<never> => ({
  ok: false,
  error:
    error instanceof Error
      ? error.message
      : "Capture failed. Please try again.",
});
export function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export function token(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9-]{36}$/.test(value);
}
export function isCapture(value: unknown): value is CaptureMessage {
  if (
    !record(value) ||
    value.type !== "capture" ||
    !(value.delivery === "preview" || value.delivery === "copy" || value.delivery === "composeItem") ||
    !token(value.session) ||
    !validRect(value.rect) ||
    !record(value.viewport)
  )
    return false;
  const v = value.viewport;
  return (
    [v.width, v.height].every(
      (n) => typeof n === "number" && Number.isFinite(n) && n > 0 && n <= 32768,
    ) &&
    [v.scrollX, v.scrollY].every(
      (n) =>
        typeof n === "number" &&
        Number.isFinite(n) &&
        Math.abs(n) <= 10_000_000,
    )
  );
}

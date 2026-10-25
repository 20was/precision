export interface CanvasPoint {
  x: number;
  y: number;
}

export interface CanvasClientRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Converts CSS client coordinates to the canvas's intrinsic image/world space. */
export function clientToCanvasPoint(
  clientX: number,
  clientY: number,
  rect: CanvasClientRect,
  imageWidth: number,
  imageHeight: number,
): CanvasPoint | null {
  if (
    !Number.isFinite(clientX) || !Number.isFinite(clientY) ||
    !Number.isFinite(rect.left) || !Number.isFinite(rect.top) ||
    !Number.isFinite(rect.width) || !Number.isFinite(rect.height) ||
    rect.width <= 0 || rect.height <= 0 ||
    !Number.isFinite(imageWidth) || !Number.isFinite(imageHeight) ||
    imageWidth <= 0 || imageHeight <= 0
  ) return null;

  return {
    x: clamp(((clientX - rect.left) * imageWidth) / rect.width, 0, imageWidth),
    y: clamp(((clientY - rect.top) * imageHeight) / rect.height, 0, imageHeight),
  };
}

/** Inverse of clientToCanvasPoint, used to express the editor's transform contract. */
export function canvasToClientPoint(
  point: CanvasPoint,
  rect: CanvasClientRect,
  imageWidth: number,
  imageHeight: number,
): CanvasPoint | null {
  if (
    !Number.isFinite(point.x) || !Number.isFinite(point.y) ||
    !Number.isFinite(rect.left) || !Number.isFinite(rect.top) ||
    !Number.isFinite(rect.width) || !Number.isFinite(rect.height) ||
    rect.width <= 0 || rect.height <= 0 ||
    !Number.isFinite(imageWidth) || !Number.isFinite(imageHeight) ||
    imageWidth <= 0 || imageHeight <= 0
  ) return null;

  return {
    x: rect.left + (point.x * rect.width) / imageWidth,
    y: rect.top + (point.y * rect.height) / imageHeight,
  };
}

/** Resizes from the bottom-right handle while preserving source aspect ratio. */
export function resizedAspectWidth(
  originalWidth: number,
  aspect: number,
  deltaX: number,
  deltaY: number,
  maxWidth: number,
  minimumWidth = 32,
): number {
  if (
    ![originalWidth, aspect, deltaX, deltaY, maxWidth, minimumWidth].every(Number.isFinite) ||
    originalWidth <= 0 || aspect <= 0 || maxWidth <= 0 || minimumWidth <= 0
  ) return 0;

  // Use whichever pointer axis moved farther in aspect-adjusted world space.
  // This keeps horizontal-only and vertical-only drags intuitive while a
  // diagonal drag follows the handle along the source's aspect-ratio slope.
  const verticalAsWidth = deltaY * aspect;
  const widthDelta = Math.abs(deltaX) >= Math.abs(verticalAsWidth)
    ? deltaX
    : verticalAsWidth;
  const minimum = Math.min(minimumWidth, maxWidth);
  return clamp(originalWidth + widthDelta, minimum, maxWidth);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

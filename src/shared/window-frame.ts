export type WindowFrameStyle = "none" | "mac" | "windows";
export type FrameContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function safeSourceUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 4096) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().slice(0, 2048);
  } catch {
    return undefined;
  }
}

/** Browser-style compact URL text for image frames (scheme is implicit). */
export function displaySourceUrl(value: unknown): string | undefined {
  return safeSourceUrl(value)?.replace(/^https?:\/\//, "");
}

export function frameDimensions(width: number, height: number, style: WindowFrameStyle, showTimestamp = false) {
  const enabled = style !== "none";
  const inset = enabled ? Math.max(16, Math.round(Math.min(width, height) * 0.025)) : 0;
  const stackMetadata = enabled && showTimestamp && width < 1000;
  const baseBar = enabled || showTimestamp ? Math.max(56, Math.min(112, Math.round(width * 0.035))) : 0;
  const bar = stackMetadata ? Math.max(72, baseBar) : baseBar;
  const footer = 0;
  // Keep the titlebar flush with the outer frame. The inset is reserved for
  // the captured page at the sides and bottom, rather than above the controls.
  return { width: width + inset * 2, height: height + inset + bar + footer, inset, bar, footer, stackMetadata };
}

export function formatCaptureTime(timestamp: number): string | undefined {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return undefined;
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      year: "numeric", month: "short", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZoneName: "short",
    }).format(timestamp);
    return parts.replace(",", " ·");
  } catch {
    return undefined;
  }
}

/** Shared preview/export limits for the capture-time label. */
export function captureTimeMetrics(imageWidth: number, frameWidth: number) {
  return {
    fontSize: Math.max(16, Math.min(24, Math.round(imageWidth * 0.01))),
    maxWidth: Math.min(420, Math.max(240, Math.round(frameWidth * 0.35))),
  };
}

export function drawWindowFrame(
  context: FrameContext,
  width: number,
  height: number,
  style: WindowFrameStyle,
  sourceUrl: string | undefined,
  showUrl: boolean,
  showTimestamp = false,
  capturedAt = Date.now(),
) {
  const dimensions = frameDimensions(width, height, style, showTimestamp);
  context.save();
  context.fillStyle = "#e6e8eb";
  if (style !== "none") {
    const outerRadius = Math.max(8, Math.min(18, Math.round(Math.min(width, height) * 0.025)));
    context.beginPath();
    context.roundRect(0, 0, dimensions.width, dimensions.height, outerRadius);
    context.fill();
    context.clip();
  } else {
    context.fillRect(0, 0, dimensions.width, dimensions.height);
  }
  if (style !== "none" || showTimestamp) {
    const { inset, bar } = dimensions;
    if (style !== "none") {
      const radius = Math.max(6, Math.min(16, Math.round(Math.min(width, height) * 0.02)));
      context.save();
      context.fillStyle = "#fff";
      context.shadowColor = "rgba(0,0,0,.2)";
      context.shadowBlur = 16;
      context.shadowOffsetY = 5;
      context.beginPath();
      context.roundRect(inset, bar, width, height, radius);
      context.fill();
      context.restore();
    }
    context.fillStyle = "#f6f7f8";
    context.fillRect(0, 0, dimensions.width, bar);
    const metadataY = dimensions.stackMetadata ? bar * 0.25 : bar / 2;
    if (style === "mac") {
      const colors = ["#ff5f57", "#febc2e", "#28c840"];
      colors.forEach((color, index) => {
        context.beginPath();
        context.fillStyle = color;
        context.arc(inset + 20 + index * 28, metadataY, 10, 0, Math.PI * 2);
        context.fill();
      });
    } else if (style === "windows") {
      const center = dimensions.width - inset - 20;
      context.strokeStyle = "#55585e";
      context.lineWidth = 1.5;
      context.beginPath();
      context.moveTo(center - 28, metadataY);
      context.lineTo(center - 18, metadataY);
      context.stroke();
      context.strokeRect(center - 3, metadataY - 5, 9, 9);
      context.beginPath();
      context.moveTo(center + 18, metadataY - 5);
      context.lineTo(center + 28, metadataY + 5);
      context.moveTo(center + 28, metadataY - 5);
      context.lineTo(center + 18, metadataY + 5);
      context.stroke();
    }
    if (style !== "none") {
      const url = showUrl ? displaySourceUrl(sourceUrl) : undefined;
        const left = style === "mac" ? inset + 100 : inset + 18;
        const timeMetrics = captureTimeMetrics(width, dimensions.width);
        const timestampWidth = style === "windows" ? Math.min(timeMetrics.maxWidth, 320) : timeMetrics.maxWidth;
        const timestampReserve = showTimestamp && !dimensions.stackMetadata ? timestampWidth + (style === "windows" ? 116 : 40) : 0;
        const right = dimensions.width - inset - (timestampReserve || (style === "windows" ? 96 : 18));
        const availableWidth = Math.max(0, right - left);
        let fieldWidth = Math.min(availableWidth, Math.round(dimensions.width * 0.46));
        if (style === "mac" && showTimestamp && !dimensions.stackMetadata) {
          const timeLeft = dimensions.width - inset - timeMetrics.maxWidth - 18;
          fieldWidth = Math.min(fieldWidth, Math.max(0, Math.floor(2 * (timeLeft - dimensions.width / 2 - 16))));
        }
        const fieldLeft = style === "mac" ? Math.round((dimensions.width - fieldWidth) / 2) : left;
        context.fillStyle = "#e9eaec";
        context.beginPath();
        const urlTop = dimensions.stackMetadata ? bar * 0.08 : bar * 0.23;
        const urlHeight = dimensions.stackMetadata ? bar * 0.34 : bar * 0.54;
        context.roundRect(fieldLeft, urlTop, fieldWidth, urlHeight, bar * 0.14);
        context.fill();
        if (url) {
          context.fillStyle = "#4a4c52";
          const urlFont = dimensions.stackMetadata ? Math.max(12, Math.min(16, Math.round(width * 0.04))) : Math.max(16, Math.min(30, Math.round(bar * 0.28)));
          context.font = `500 ${urlFont}px sans-serif`;
          context.textBaseline = "middle";
          context.fillText(url, fieldLeft + 12, dimensions.stackMetadata ? bar * 0.25 : bar / 2, Math.max(0, fieldWidth - 24));
        }
    }
    if (showTimestamp) {
    const text = formatCaptureTime(capturedAt);
    if (text) {
      const { fontSize: defaultFontSize, maxWidth: defaultMaxWidth } = captureTimeMetrics(width, dimensions.width);
      const fontSize = dimensions.stackMetadata ? Math.max(12, Math.min(14, Math.round(width * 0.05))) : defaultFontSize;
      const maxWidth = dimensions.stackMetadata ? dimensions.width - dimensions.inset * 2 - 36 : defaultMaxWidth;
      context.fillStyle = "#3f4146";
      context.font = `600 ${fontSize}px sans-serif`;
      context.textBaseline = "middle";
      context.textAlign = "right";
      context.fillText(text, dimensions.width - dimensions.inset - (dimensions.stackMetadata ? 18 : style === "windows" ? 96 : 18), dimensions.stackMetadata ? dimensions.bar * 0.75 : dimensions.bar / 2, Math.min(maxWidth, style === "windows" ? 320 : maxWidth));
      context.textAlign = "start";
    }
  }
  }
  if (style !== "none") {
    context.save();
    context.strokeStyle = "#cfd2d6";
    context.lineWidth = 1;
    const radius = Math.max(8, Math.min(18, Math.round(Math.min(width, height) * 0.025)));
    context.beginPath();
    context.roundRect(0.5, 0.5, dimensions.width - 1, dimensions.height - 1, radius);
    context.stroke();
    context.restore();
  }
  context.restore();
  return dimensions;
}

export function clipWindowContent(context: FrameContext, width: number, height: number, style: WindowFrameStyle, showTimestamp = false) {
  const dimensions = frameDimensions(width, height, style, showTimestamp);
  if (style !== "none" || showTimestamp) {
    const radius = Math.max(6, Math.min(16, Math.round(Math.min(width, height) * 0.02)));
    if (style !== "none") {
      context.beginPath();
      context.roundRect(dimensions.inset, dimensions.bar, width, height, radius);
      context.clip();
    }
    context.translate(dimensions.inset, dimensions.bar);
  }
  return dimensions;
}

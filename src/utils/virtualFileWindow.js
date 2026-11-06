export const FILE_ROW_HEIGHT = 32;
// Stay well below WebView/Chromium layout limits, even for 10,000,000 rows.
export const MAX_SCROLL_HEIGHT = 1_000_000;
export const FILE_OVERSCAN = 6;
export const MAX_FILE_OVERSCAN = 48;
export const FAST_FILE_SCROLL_SPEED = 2; // logical pixels per millisecond
export const FILE_SCROLL_IDLE_MS = 120;

export function fileWindow(count, viewport, offset, rowHeight = FILE_ROW_HEIGHT, velocity = 0, extraHeight = 0) {
  const logicalHeight = count * rowHeight + extraHeight;
  const physicalHeight = Math.min(logicalHeight, MAX_SCROLL_HEIGHT + extraHeight);
  const logicalMax = Math.max(0, logicalHeight - viewport);
  const physicalMax = Math.max(0, physicalHeight - viewport);
  const logicalOffset = Math.max(0, Math.min(offset, logicalMax));
  const physicalOffset = logicalMax ? logicalOffset / logicalMax * physicalMax : 0;
  const visibleStart = Math.floor(logicalOffset / rowHeight);
  const visibleEnd = Math.min(count, Math.ceil((logicalOffset + viewport) / rowHeight));
  const ahead = Math.min(MAX_FILE_OVERSCAN, FILE_OVERSCAN + Math.ceil(Math.abs(velocity) * 80 / rowHeight));
  const start = Math.max(0, visibleStart - (velocity < 0 ? ahead : FILE_OVERSCAN));
  const end = Math.min(count, visibleEnd + (velocity > 0 ? ahead : FILE_OVERSCAN));
  return { start, end, visibleStart, visibleEnd, velocity, direction: Math.sign(velocity), viewport,
    logicalOffset, logicalMax, physicalOffset, physicalMax, physicalHeight, logicalHeight };
}

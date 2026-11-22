/**
 * 历史/版本列表的显示格式。
 *
 * 时间：当天只显示 HH:mm；跨天显示 M/D HH:mm；跨年显示 YYYY/M/D HH:mm。
 * 大小：B / KB / MB，保留一位小数。
 */
export function formatHistoryTime(timestamp) {
  // Plugins may hand over epoch milliseconds as a number or a numeric string.
  const value =
    typeof timestamp === 'string' && /^\d+$/.test(timestamp) ? Number(timestamp) : timestamp;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return time;
  const sameYear = date.getFullYear() === now.getFullYear();
  const day = date.toLocaleDateString(
    undefined,
    sameYear
      ? { month: '2-digit', day: '2-digit' }
      : { year: 'numeric', month: '2-digit', day: '2-digit' },
  );
  return `${day} ${time}`;
}

export function formatHistoryBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

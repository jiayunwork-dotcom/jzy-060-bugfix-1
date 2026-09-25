/** 时间/数值展示小工具。 */

export function formatTime(ts: number | null | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleTimeString('zh-CN', { hour12: false });
}

export function formatClock(ts: number | null | undefined): string {
  if (!ts) return '--:--:--';
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false });
}

export function formatValue(value: number | null | undefined, decimals = 1, unit = ''): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${value.toFixed(decimals)}${unit ? ` ${unit}` : ''}`;
}

export function formatDateTimeLocal(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

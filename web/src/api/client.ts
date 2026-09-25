/** REST 接口封装。生产与开发态都走同源 /api。 */
import type { AlertLevel, AlertOperator, HistoryResponse, LayoutConfig, SourceState, AlertRule } from '../types';

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  sources: () => jsonFetch<SourceState[]>('/api/sources'),

  setSourceEnabled: (id: string, enabled: boolean) =>
    jsonFetch<SourceState>(`/api/sources/${id}/enabled`, {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    }),

  rules: () => jsonFetch<AlertRule[]>('/api/alerts/rules'),

  createRule: (input: { sourceId: string; level: AlertLevel; operator: AlertOperator; threshold: number; enabled: boolean; note: string }) =>
    jsonFetch<AlertRule>('/api/alerts/rules', { method: 'POST', body: JSON.stringify(input) }),

  updateRule: (
    id: string,
    patch: Partial<{ sourceId: string; level: AlertLevel; operator: AlertOperator; threshold: number; enabled: boolean; note: string }>,
  ) => jsonFetch<AlertRule>(`/api/alerts/rules/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),

  deleteRule: (id: string) => jsonFetch<{ ok: true }>(`/api/alerts/rules/${id}`, { method: 'DELETE' }),

  history: (from: number, to: number, sources?: string[]) =>
    jsonFetch<HistoryResponse>(
      `/api/history?from=${from}&to=${to}${sources && sources.length ? `&sources=${sources.join(',')}` : ''}`,
    ),

  getLayout: () => jsonFetch<{ layout: LayoutConfig }>('/api/layout'),

  saveLayout: (layout: LayoutConfig) =>
    jsonFetch<{ ok: true }>('/api/layout', { method: 'PUT', body: JSON.stringify({ layout }) }),
};

/** WebSocket 地址与当前页面同源，走 /api/ws。 */
export function wsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/api/ws`;
}

/**
 * 全局实时状态（zustand）：
 * 一条 WebSocket 长连接，接收服务端主动推送的快照 / 指标 / 源状态 / 告警事件；
 * 每路源在内存里维护最近约 5 分钟的滑动窗口供图表渲染。
 */
import { create } from 'zustand';
import { api, wsUrl } from '../api/client';
import type { AlertEvent, AlertRule, MetricPoint, SourceState } from '../types';

const WINDOW_MS = 5 * 60 * 1000 + 5000;
const MAX_POINTS_PER_SOURCE = 400;

export interface Toast {
  id: string;
  level: 'warning' | 'critical' | 'info';
  title: string;
  message: string;
  ts: number;
}

interface DashboardState {
  connected: boolean;
  sources: SourceState[];
  rules: AlertRule[];
  actives: AlertEvent[];
  /** sourceId -> 最近五分钟点序列 */
  series: Record<string, MetricPoint[]>;
  toasts: Toast[];
  lastTickTs: number | null;

  connect: () => () => void;
  pushToast: (t: Omit<Toast, 'id' | 'ts'>) => void;
  dismissToast: (id: string) => void;
  refreshRules: () => Promise<void>;
}

function appendPoint(series: Record<string, MetricPoint[]>, point: MetricPoint, now: number): void {
  let arr = series[point.sourceId];
  if (!arr) arr = series[point.sourceId] = [];
  arr.push(point);
  // 滑窗：先按时间裁剪，再兜底限制长度
  while (arr.length > 2 && (now - arr[0].ts > WINDOW_MS || arr.length > MAX_POINTS_PER_SOURCE)) {
    arr.shift();
  }
}

function sourceName(sources: SourceState[], id: string): string {
  return sources.find((s) => s.def.id === id)?.def.name ?? id;
}

export const useDashboard = create<DashboardState>((set, get) => {
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let closedByUs = false;

  const handleMessage = (raw: string) => {
    const msg = JSON.parse(raw);
    const state = get();
    switch (msg.type) {
      case 'snapshot': {
        // 快照只同步源/规则/激活态；latest 与同一拍的 metrics 重复，
        // 不再重复追加进滑动窗口（走势由初始 /history + 后续 metrics 构成）。
        set({
          sources: msg.sources,
          rules: msg.rules,
          actives: msg.actives,
          lastTickTs: msg.ts,
        });
        break;
      }
      case 'metrics': {
        const now = Date.now();
        const series: Record<string, MetricPoint[]> = {};
        for (const k of Object.keys(state.series)) series[k] = state.series[k];
        for (const p of msg.points as MetricPoint[]) appendPoint(series, p, now);
        set({ series, lastTickTs: now });
        break;
      }
      case 'source': {
        set({ sources: state.sources.map((s) => (s.def.id === msg.source.def.id ? msg.source : s)) });
        break;
      }
      case 'rules':
        set({ rules: msg.rules });
        break;
      case 'alert_event': {
        const event = msg.event as AlertEvent;
        set({ actives: msg.actives });
        if (event.phase === 'fired') {
          get().pushToast({
            level: event.level,
            title: event.level === 'critical' ? '严重告警' : '警告',
            message: `${sourceName(get().sources, event.sourceId)} 当前 ${event.value}，已${event.operator}阈值 ${event.threshold}`,
          });
        }
        break;
      }
    }
  };

  const connect = () => {
    closedByUs = false;
    const open = () => {
      socket = new WebSocket(wsUrl());
      socket.onopen = () => set({ connected: true });
      socket.onmessage = (ev) => {
        try {
          handleMessage(String(ev.data));
        } catch (err) {
          console.error('解析推送消息失败', err);
        }
      };
      socket.onclose = () => {
        set({ connected: false });
        if (!closedByUs) {
          reconnectTimer = setTimeout(open, 1500);
        }
      };
      socket.onerror = () => socket?.close();
    };
    open();

    // 建连后拉一次最近 5 分钟真实历史，立刻画出走势；与已收到的实时点按时间戳合并去重
    api
      .history(Date.now() - WINDOW_MS, Date.now())
      .then((res) => {
        const liveSeries = get().series;
        const merged: Record<string, MetricPoint[]> = {};
        for (const id of Object.keys(res.series)) {
          const hist = res.series[id].points.map((p) => ({ sourceId: id, ts: p.ts, value: p.value }));
          const live = liveSeries[id] ?? [];
          const histLastTs = hist.length ? hist[hist.length - 1].ts : 0;
          // 历史之后到达的实时点保留；与历史时间戳重复的丢弃
          const freshLive = live.filter((p) => p.ts > histLastTs);
          merged[id] = hist.concat(freshLive).sort((a, b) => a.ts - b.ts);
        }
        // 历史里没有、但实时已有（极罕见）的序列也保留
        for (const id of Object.keys(liveSeries)) {
          if (!merged[id]) merged[id] = liveSeries[id];
        }
        set({ series: merged });
      })
      .catch(() => undefined);

    return () => {
      closedByUs = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    };
  };

  return {
    connected: false,
    sources: [],
    rules: [],
    actives: [],
    series: {},
    toasts: [],
    lastTickTs: null,

    connect,
    pushToast: (t) => {
      const toast: Toast = { ...t, id: `t_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, ts: Date.now() };
      set((s) => ({ toasts: [toast, ...s.toasts].slice(0, 5) }));
      // 严重告警保留更久，警告自动淡出
      setTimeout(() => get().dismissToast(toast.id), t.level === 'critical' ? 12000 : 7000);
    },
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
    refreshRules: async () => set({ rules: await api.rules() }),
  };
});

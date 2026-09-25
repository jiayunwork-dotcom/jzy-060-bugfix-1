/**
 * 运行时装配：把注册表、模拟器、历史留档、告警引擎、推送中心串起来，
 * 并驱动每秒一次的实时节拍与 24 小时窗口的滚动淘汰。
 */
import type { AppConfig } from './config';
import type { AlertEvent, MetricPoint, SourceState } from './types';
import { ConfigStore } from './storage/configStore';
import { HistoryStore } from './storage/historyStore';
import { SourceRegistry } from './sources/registry';
import { Simulator } from './sources/simulator';
import { AlertEngine } from './alerts/engine';
import { Hub } from './realtime/hub';

export interface IngestResult {
  point: MetricPoint;
  events: AlertEvent[];
}

export class Runtime {
  readonly config: AppConfig;
  readonly configStore: ConfigStore;
  readonly history: HistoryStore;
  readonly registry: SourceRegistry;
  readonly simulator: Simulator;
  readonly alerts: AlertEngine;
  readonly hub: Hub;

  private tickTimer: NodeJS.Timeout | null = null;
  private pruneTimer: NodeJS.Timeout | null = null;

  constructor(config: AppConfig) {
    this.config = config;
    this.configStore = new ConfigStore(config.dataDir);
    this.history = new HistoryStore(config.dataDir, config.retentionMs);
    this.registry = new SourceRegistry(this.configStore);
    for (const s of this.registry.list()) this.history.register(s.def.id);
    this.simulator = new Simulator(this.registry);
    this.alerts = new AlertEngine(this.configStore);
    this.hub = new Hub();
  }

  /** 冷启动：预填五分钟历史，然后开始周期性产出与推送。 */
  start(): void {
    const now = Date.now();
    this.simulator.prefill(now, this.config.prefillMs, this.config.tickMs, (sourceId, ts, value) => {
      this.history.add(sourceId, ts, value);
    });
    this.history.flush();

    this.tickTimer = setInterval(() => this.runTick(), this.config.tickMs);
    this.tickTimer.unref?.();
    this.pruneTimer = setInterval(() => {
      this.history.prune(Date.now());
    }, this.config.pruneIntervalMs);
    this.pruneTimer.unref?.();
  }

  /** 构造全量快照，WS 建连时与每拍同步源状态时使用。 */
  buildSnapshot() {
    return {
      type: 'snapshot' as const,
      sources: this.registry.list(),
      rules: this.configStore.getRules(),
      actives: this.alerts.getActives(),
      latest: this.history.latestAll(),
      ts: Date.now(),
    };
  }

  /** 一个实时节拍：模拟产出 -> 留档 -> 告警判定 -> 服务端主动推送。 */
  runTick(ts: number = Date.now()): MetricPoint[] {
    const statusBefore = new Map(this.registry.list().map((s) => [s.def.id, s.status]));
    const points = this.simulator.tick(ts);
    if (points.length) this.ingestPoints(points);
    // 本拍转入采集异常的源：其名下激活告警立即解除，不等恢复后的新点
    for (const s of this.registry.list()) {
      if (s.status === 'error' && statusBefore.get(s.def.id) !== 'error') {
        this.resolveSourceAlerts(s.def.id, ts);
      }
    }
    // 源状态（含故障标记）也每拍同步给页面
    this.hub.broadcast(this.buildSnapshot());
    return points;
  }

  /**
   * 采集单个点（实时路径与测试注入路径共用）：
   * 留档（24h）、告警判定、通过长连接主动推给页面。
   */
  ingest(point: MetricPoint): IngestResult {
    this.history.add(point.sourceId, point.ts, point.value);
    this.registry.reportPoint(point.sourceId, point.ts);
    const events = this.alerts.evaluate(point);
    if (events.length) this.emitAlertEvents(events);
    this.hub.broadcast({ type: 'metrics', points: [point] });
    return { point, events };
  }

  ingestPoints(points: MetricPoint[]): AlertEvent[] {
    const allEvents: AlertEvent[] = [];
    for (const p of points) {
      this.history.add(p.sourceId, p.ts, p.value);
      this.registry.reportPoint(p.sourceId, p.ts);
      allEvents.push(...this.alerts.evaluate(p));
    }
    if (eventsAny(allEvents)) this.emitAlertEvents(allEvents);
    this.hub.broadcast({ type: 'metrics', points });
    return allEvents;
  }

  /** 规则增删改后立即按最新值重判，并把结果推出去。 */
  resyncAlerts(): AlertEvent[] {
    const events = this.alerts.resync(Date.now());
    if (events.length) this.emitAlertEvents(events);
    return events;
  }

  /** 手动开/关某路源的采集；关闭时其名下激活告警立即解除。 */
  setSourceEnabled(id: string, enabled: boolean): SourceState | undefined {
    const s = this.registry.setEnabled(id, enabled);
    if (!s) return undefined;
    if (!enabled) this.resolveSourceAlerts(id);
    return s;
  }

  /** 某源停止产出（被关闭或采集异常）时，立即解除其名下所有激活告警并推送。 */
  resolveSourceAlerts(sourceId: string, ts: number = Date.now()): AlertEvent[] {
    const events = this.alerts.resolveSource(sourceId, ts);
    if (events.length) this.emitAlertEvents(events);
    return events;
  }

  emitAlertEvents(events: AlertEvent[]): void {
    for (const event of events) {
      this.hub.broadcast({ type: 'alert_event', event, actives: this.alerts.getActives() });
    }
  }

  broadcastSource(source: SourceState): void {
    this.hub.broadcast({ type: 'source', source });
  }

  broadcastRules(): void {
    this.hub.broadcast({ type: 'rules', rules: this.configStore.getRules() });
  }

  stop(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    this.history.close();
  }
}

function eventsAny(events: AlertEvent[]): boolean {
  return events.length > 0;
}

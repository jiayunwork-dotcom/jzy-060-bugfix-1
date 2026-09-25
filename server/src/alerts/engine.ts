/**
 * 告警引擎：对每个进来的数据点评估其绑定的规则。
 * 规则严格按 threshold + operator 判定：越过即 fired、回到安全侧即 resolved，
 * 不设迟滞，保证“改动阈值后立刻按新阈值判定”可被测试锁定。
 */
import type { ActiveAlert, AlertEvent, AlertRule, MetricPoint } from '../types';
import type { ConfigStore } from '../storage/configStore';
import { shortId } from '../util/random';

export class AlertEngine {
  private config: ConfigStore;
  /** 激活告警：ruleId -> fired 事件；安全后移除 */
  private actives = new Map<string, ActiveAlert>();
  /** 最近事件（fired/resolved 都在），最多保留 200 条 */
  private events: AlertEvent[] = [];
  /** 测试/外部注入点时同步各源最近一个值，供规则改阈值后立即重判 */
  private lastValue = new Map<string, number>();

  constructor(config: ConfigStore) {
    this.config = config;
  }

  private static violates(rule: AlertRule, value: number): boolean {
    switch (rule.operator) {
      case '>':
        return value > rule.threshold;
      case '<':
        return value < rule.threshold;
      case '>=':
        return value >= rule.threshold;
      case '<=':
        return value <= rule.threshold;
    }
  }

  private fire(rule: AlertRule, value: number, ts: number): AlertEvent {
    const event: AlertEvent = {
      id: shortId('evt_'),
      ruleId: rule.id,
      sourceId: rule.sourceId,
      level: rule.level,
      operator: rule.operator,
      threshold: rule.threshold,
      value,
      phase: 'fired',
      ts,
    };
    this.actives.set(rule.id, event);
    this.pushEvent(event);
    return event;
  }

  private resolve(rule: AlertRule, value: number, ts: number): AlertEvent {
    this.actives.delete(rule.id);
    const event: AlertEvent = {
      id: shortId('evt_'),
      ruleId: rule.id,
      sourceId: rule.sourceId,
      level: rule.level,
      operator: rule.operator,
      threshold: rule.threshold,
      value,
      phase: 'resolved',
      ts,
    };
    this.pushEvent(event);
    return event;
  }

  private pushEvent(event: AlertEvent): void {
    this.events.unshift(event);
    if (this.events.length > 200) this.events.length = 200;
  }

  private evalRule(rule: AlertRule, value: number, ts: number, emit: (e: AlertEvent) => void): void {
    if (!rule.enabled) return;
    const active = this.actives.has(rule.id);
    const bad = AlertEngine.violates(rule, value);
    if (bad && !active) emit(this.fire(rule, value, ts));
    else if (!bad && active) emit(this.resolve(rule, value, ts));
  }

  /** 评估一个数据点，返回本次产生的告警/解除事件。 */
  evaluate(point: MetricPoint): AlertEvent[] {
    this.lastValue.set(point.sourceId, point.value);
    const emitted: AlertEvent[] = [];
    for (const rule of this.config.getRules()) {
      if (rule.sourceId !== point.sourceId) continue;
      this.evalRule(rule, point.value, point.ts, (e) => emitted.push(e));
    }
    return emitted;
  }

  /**
   * 规则被新增/修改/删除后，用各源“最近一个真实值”立刻按新规则重判，
   * 让阈值改动立即生效；返回由此产生的事件。
   */
  resync(ts: number = Date.now()): AlertEvent[] {
    const emitted: AlertEvent[] = [];
    for (const rule of this.config.getRules()) {
      const value = this.lastValue.get(rule.sourceId);
      if (value === undefined) continue;
      this.evalRule(rule, value, ts, (e) => emitted.push(e));
    }
    return emitted;
  }

  /** 规则被删除或停用：若它正激活，立即解除。 */
  deactivate(ruleId: string, ts: number = Date.now()): AlertEvent | null {
    const active = this.actives.get(ruleId);
    if (!active) return null;
    this.actives.delete(ruleId);
    const event: AlertEvent = { ...active, id: shortId('evt_'), phase: 'resolved', ts };
    this.pushEvent(event);
    return event;
  }

  /**
   * 某数据源停止产出（被手动关闭或采集异常）：其名下所有激活告警立即解除，
   * 不再干等下一个数据点；同时丢弃该源的“最近值”，避免规则改动时拿
   * 停采前的旧读数重判出虚假告警。返回本次解除产生的事件。
   */
  resolveSource(sourceId: string, ts: number = Date.now()): AlertEvent[] {
    this.lastValue.delete(sourceId);
    const emitted: AlertEvent[] = [];
    for (const [ruleId, active] of this.actives) {
      if (active.sourceId !== sourceId) continue;
      this.actives.delete(ruleId);
      const event: AlertEvent = { ...active, id: shortId('evt_'), phase: 'resolved', ts };
      this.pushEvent(event);
      emitted.push(event);
    }
    return emitted;
  }

  setLastValue(sourceId: string, value: number): void {
    this.lastValue.set(sourceId, value);
  }

  getActives(): ActiveAlert[] {
    return [...this.actives.values()];
  }

  getEvents(limit = 100): AlertEvent[] {
    return this.events.slice(0, limit);
  }
}

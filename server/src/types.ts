/**
 * 共享领域类型：数据点、数据源、告警规则/事件、布局。
 * 前端在 web/src/types.ts 内保持结构一致的镜像定义。
 */

export type SourceKind = 'system' | 'business';
export type SourceStatus = 'ok' | 'error';

export interface SourceDef {
  id: string;
  name: string;
  kind: SourceKind;
  unit: string;
  /** 展示用满量程，用于柱状图横向对比与仪表盘满刻度 */
  max: number;
  /** 建议小数位 */
  decimals: number;
  description: string;
}

export interface MetricPoint {
  sourceId: string;
  /** epoch 毫秒 */
  ts: number;
  value: number;
}

export interface SourceState {
  def: SourceDef;
  enabled: boolean;
  status: SourceStatus;
  /** 当 status=error 时的说明文本 */
  lastError: string | null;
  /** 最近一次产出数据点的时间（毫秒），无则 null */
  lastPointTs: number | null;
}

export type AlertLevel = 'warning' | 'critical';
export type AlertOperator = '>' | '<' | '>=' | '<=';

export interface AlertRule {
  id: string;
  sourceId: string;
  level: AlertLevel;
  operator: AlertOperator;
  threshold: number;
  enabled: boolean;
  note: string;
  createdAt: number;
  updatedAt: number;
}

export interface AlertEvent {
  id: string;
  ruleId: string;
  sourceId: string;
  level: AlertLevel;
  operator: AlertOperator;
  threshold: number;
  value: number;
  /** fired = 越限触发，resolved = 回落后解除 */
  phase: 'fired' | 'resolved';
  ts: number;
}

/** 当前仍处于激活状态的告警（由规则 id 索引） */
export type ActiveAlert = AlertEvent;

/** 前端保存下来的布局（react-grid-layout 的布局数组原样存储） */
export type LayoutConfig = Record<string, unknown>[];

/** WebSocket 下行消息 */
export type WsMessage =
  | { type: 'snapshot'; sources: SourceState[]; rules: AlertRule[]; actives: ActiveAlert[]; latest: MetricPoint[]; ts: number }
  | { type: 'metrics'; points: MetricPoint[] }
  | { type: 'source'; source: SourceState }
  | { type: 'alert_event'; event: AlertEvent; actives: ActiveAlert[] }
  | { type: 'rules'; rules: AlertRule[] };

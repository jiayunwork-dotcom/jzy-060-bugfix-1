/** 与后端 server/src/types.ts 结构保持一致的前端镜像定义。 */

export type SourceKind = 'system' | 'business';
export type SourceStatus = 'ok' | 'error';
export type AlertLevel = 'warning' | 'critical';
export type AlertOperator = '>' | '<' | '>=' | '<=';

export interface SourceDef {
  id: string;
  name: string;
  kind: SourceKind;
  unit: string;
  max: number;
  decimals: number;
  description: string;
}

export interface MetricPoint {
  sourceId: string;
  ts: number;
  value: number;
}

export interface SourceState {
  def: SourceDef;
  enabled: boolean;
  status: SourceStatus;
  lastError: string | null;
  lastPointTs: number | null;
}

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
  phase: 'fired' | 'resolved';
  ts: number;
}

export interface HistoryResponse {
  from: number;
  to: number;
  tickMs: number;
  series: Record<string, { sourceId: string; points: { ts: number; value: number }[] }>;
}

export type RGLPosition = {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type LayoutConfig = RGLPosition[];

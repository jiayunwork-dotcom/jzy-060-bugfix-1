/** 图表卡片外壳：标题、状态点、级别描边，可嵌入 react-grid-layout。 */
import type { ReactNode } from 'react';
import type { SourceState } from '../types';

interface ChartCardProps {
  title: string;
  subtitle?: string;
  source?: SourceState;
  level?: 'none' | 'warning' | 'critical';
  children: ReactNode;
  actions?: ReactNode;
}

export default function ChartCard({ title, subtitle, source, level = 'none', children, actions }: ChartCardProps) {
  const status = source?.status;
  return (
    <div className={`chart-card ${level === 'critical' ? 'card-critical' : level === 'warning' ? 'card-warning' : ''}`}>
      <div className="chart-card-head">
        <div className="chart-card-title">
          <span className="card-title-text">{title}</span>
          {source && (
            <span
              className={`status-dot ${source.enabled ? (status === 'error' ? 'status-error' : 'status-ok') : 'status-off'}`}
              title={source.enabled ? (status === 'error' ? source.lastError ?? '异常' : '正常') : '采集已关闭'}
            />
          )}
          {subtitle && <span className="card-subtitle">{subtitle}</span>}
        </div>
        {actions && <div className="chart-card-actions">{actions}</div>}
      </div>
      <div className="chart-card-body">{children}</div>
    </div>
  );
}

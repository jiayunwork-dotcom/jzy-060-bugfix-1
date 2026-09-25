/** 数据源管理页：源列表、正常/异常状态、采集开关集中操作，并管理该源的告警规则。 */
import { useState } from 'react';
import { api } from '../api/client';
import { useDashboard } from '../store/useDashboard';
import ChartCard from '../components/ChartCard';
import AlertRulesPanel from '../components/AlertRulesPanel';
import { formatClock } from '../utils/format';

export default function SourcesPage() {
  const sources = useDashboard((s) => s.sources);
  const [busy, setBusy] = useState<string | null>(null);

  const toggle = async (id: string, enabled: boolean) => {
    setBusy(id);
    try {
      await api.setSourceEnabled(id, enabled);
      // 快照推送会同步状态，这里无需手动刷新
    } finally {
      setBusy(null);
    }
  };

  const kindLabel = (kind: string) => (kind === 'system' ? '系统指标' : '业务指标');

  return (
    <div>
      <div className="page-head">
        <h2>数据源管理</h2>
        <span className="conn conn-on">共 {sources.length} 路 · 开启 {sources.filter((s) => s.enabled).length} 路 · 异常 {sources.filter((s) => s.status === 'error' && s.enabled).length} 路</span>
      </div>

      <ChartCard title="采集源列表" subtitle="关闭后该源不再产生新的数据点，也不会推送">
        <table className="source-table">
          <thead>
            <tr>
              <th>指标</th>
              <th>类型</th>
              <th>状态</th>
              <th>最近数据点</th>
              <th>说明</th>
              <th>采集开关</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.def.id} className={!s.enabled ? 'row-off' : s.status === 'error' ? 'row-error' : ''}>
                <td>
                  <strong>{s.def.name}</strong>
                  <span className="source-id">{s.def.id}</span>
                </td>
                <td>{kindLabel(s.def.kind)}</td>
                <td>
                  {!s.enabled ? (
                    <span className="tag tag-off">已关闭</span>
                  ) : s.status === 'error' ? (
                    <span className="tag tag-error" title={s.lastError ?? ''}>
                      异常
                    </span>
                  ) : (
                    <span className="tag tag-ok">正常</span>
                  )}
                </td>
                <td>{formatClock(s.lastPointTs)}</td>
                <td className="source-desc">
                  {s.def.description}
                  {s.status === 'error' && s.enabled && <div className="source-err">{s.lastError}</div>}
                </td>
                <td>
                  <button
                    type="button"
                    className={`switch ${s.enabled ? 'switch-on' : ''}`}
                    disabled={busy === s.def.id}
                    onClick={() => toggle(s.def.id, !s.enabled)}
                    aria-label={s.enabled ? '关闭采集' : '开启采集'}
                  >
                    <span className="switch-knob" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ChartCard>

      <ChartCard title="全部告警规则">
        <AlertRulesPanel sources={sources} />
      </ChartCard>
    </div>
  );
}

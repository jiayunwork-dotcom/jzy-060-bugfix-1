/** 激活告警横幅：warning / critical 两档颜色与文案明确区分。 */
import { useDashboard } from '../store/useDashboard';

export default function AlertBanner() {
  const actives = useDashboard((s) => s.actives);
  const sources = useDashboard((s) => s.sources);

  if (actives.length === 0) {
    return <div className="alert-banner alert-none">当前无激活告警，所有已配置规则均处于安全区间</div>;
  }

  const nameOf = (id: string) => sources.find((s) => s.def.id === id)?.def.name ?? id;

  return (
    <div className="alert-banner-stack">
      {actives.map((a) => (
        <div key={a.id} className={`alert-banner ${a.level === 'critical' ? 'alert-critical' : 'alert-warning'}`}>
          <span className="alert-badge">{a.level === 'critical' ? '严重' : '警告'}</span>
          <span className="alert-text">
            <strong>{nameOf(a.sourceId)}</strong> 当前 {a.value}，{a.operator} 阈值 {a.threshold}
          </span>
          <span className="alert-time">{new Date(a.ts).toLocaleTimeString('zh-CN', { hour12: false })}</span>
        </div>
      ))}
    </div>
  );
}

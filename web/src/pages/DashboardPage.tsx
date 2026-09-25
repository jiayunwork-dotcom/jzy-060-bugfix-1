/** 仪表板主页：可布局网格内放置对比柱图、各源表盘与趋势折线。 */
import { useMemo } from 'react';
import { useDashboard } from '../store/useDashboard';
import ChartCard from '../components/ChartCard';
import DashboardGrid from '../components/DashboardGrid';
import GaugeChart from '../components/charts/GaugeChart';
import TrendLine from '../components/charts/TrendLine';
import CompareBars from '../components/charts/CompareBars';
import AlertBanner from '../components/AlertBanner';

export default function DashboardPage() {
  const sources = useDashboard((s) => s.sources);
  const series = useDashboard((s) => s.series);
  const rules = useDashboard((s) => s.rules);
  const actives = useDashboard((s) => s.actives);
  const connected = useDashboard((s) => s.connected);

  const enabledSources = sources.filter((s) => s.enabled);
  const levelOf = (sourceId: string): 'none' | 'warning' | 'critical' => {
    const active = actives.filter((a) => a.sourceId === sourceId);
    if (active.some((a) => a.level === 'critical')) return 'critical';
    if (active.some((a) => a.level === 'warning')) return 'warning';
    return 'none';
  };
  const latestOf = useMemo(() => {
    const map: Record<string, number | null> = {};
    for (const s of sources) {
      const arr = series[s.def.id];
      map[s.def.id] = arr && arr.length ? arr[arr.length - 1].value : null;
    }
    return map;
  }, [sources, series]);

  const widgets = [
    {
      key: 'compare',
      default: { i: 'compare', x: 0, y: 0, w: 12, h: 5 },
      node: (
        <ChartCard title="指标横向对比" subtitle="当前值占满量程百分比（按告警级别变色）">
          <CompareBars sources={enabledSources} latest={latestOf} levelOf={levelOf} height={272} />
        </ChartCard>
      ),
    },
    ...enabledSources.map((s, idx) => {
      const pts = series[s.def.id] ?? [];
      const level = levelOf(s.def.id);
      return {
        key: `gauge-${s.def.id}`,
        default: {
          i: `gauge-${s.def.id}`,
          x: (idx * 4) % 12,
          y: 5 + Math.floor(idx / 3) * 5,
          w: 4,
          h: 5,
        },
        node: (
          <ChartCard title={s.def.name} source={s} level={level}>
            <GaugeChart
              title={s.status === 'error' ? '采集中断' : s.def.description}
              unit={s.def.unit}
              max={s.def.max}
              decimals={s.def.decimals}
              value={pts.length ? pts[pts.length - 1].value : null}
              rules={rules.filter((r) => r.sourceId === s.def.id && r.enabled)}
              level={level}
            />
          </ChartCard>
        ),
      };
    }),
    ...enabledSources.map((s, idx) => {
      const pts = series[s.def.id] ?? [];
      const level = levelOf(s.def.id);
      return {
        key: `trend-${s.def.id}`,
        default: {
          i: `trend-${s.def.id}`,
          x: (idx % 2) * 6,
          y: 100 + Math.floor(idx / 2) * 6,
          w: 6,
          h: 6,
        },
        node: (
          <ChartCard title={`${s.def.name} · 最近 5 分钟走势`} source={s} level={level}>
            <TrendLine
              series={[{ sourceId: s.def.id, name: s.def.name, color: '#3b82f6', points: pts }]}
              rules={rules.filter((r) => r.sourceId === s.def.id && r.enabled)}
              level={level}
              height={250}
            />
          </ChartCard>
        ),
      };
    }),
  ];

  return (
    <div>
      <div className="page-head">
        <h2>实时监控</h2>
        <span className={connected ? 'conn conn-on' : 'conn conn-off'}>{connected ? '● WebSocket 已连接 · 服务端推送中' : '○ 连接断开，正在重连…'}</span>
      </div>
      <AlertBanner />
      <DashboardGrid widgets={widgets} />
    </div>
  );
}

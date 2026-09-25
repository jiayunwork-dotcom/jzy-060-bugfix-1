/** 折线趋势图：展示一路或多路指标最近的走势，支持告警区间着色。 */
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine, CartesianGrid } from 'recharts';
import type { AlertRule, MetricPoint } from '../../types';
import { formatTime } from '../../utils/format';

interface TrendLineProps {
  /** 单路：一条线；多路（回放）：多条线 */
  series: { sourceId: string; name: string; color: string; points: MetricPoint[] }[];
  height?: number;
  rules?: AlertRule[];
  /** 当前激活级别，驱动线条变色 */
  level?: 'none' | 'warning' | 'critical';
}

const COLORS = ['#3b82f6', '#22c55e', '#a855f7', '#f97316', '#06b6d4', '#eab308'];

function mergeSeries(series: TrendLineProps['series']) {
  const map = new Map<number, Record<string, number>>();
  series.forEach((s) => {
    for (const p of s.points) {
      const row = map.get(p.ts) ?? ({ ts: p.ts } as Record<string, number>);
      row[s.sourceId] = p.value;
      map.set(p.ts, row);
    }
  });
  return [...map.values()].sort((a, b) => (a.ts as number) - (b.ts as number));
}

export default function TrendLine({ series, height = 220, rules = [], level = 'none' }: TrendLineProps) {
  const data = mergeSeries(series);
  const stroke = level === 'critical' ? '#e5484d' : level === 'warning' ? '#f5a524' : undefined;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: -8 }}>
        <CartesianGrid stroke="#1f2a3a" strokeDasharray="3 3" />
        <XAxis
          dataKey="ts"
          tickFormatter={(v) => formatTime(v as number)}
          stroke="#64748b"
          fontSize={11}
          minTickGap={48}
        />
        <YAxis stroke="#64748b" fontSize={11} domain={['auto', 'auto']} />
        <Tooltip
          contentStyle={{ background: '#0f1722', border: '1px solid #243042', borderRadius: 8, fontSize: 12 }}
          labelFormatter={(v) => formatTime(v as number)}
          formatter={(value: number, name: string) => [Number(value).toFixed(2), name]}
        />
        {series.map((s, i) => (
          <Line
            key={s.sourceId}
            type="monotone"
            dataKey={s.sourceId}
            name={s.name}
            dot={false}
            strokeWidth={2}
            stroke={series.length === 1 ? stroke ?? s.color : s.color || COLORS[i % COLORS.length]}
            isAnimationActive={false}
            connectNulls
          />
        ))}
        {rules
          .filter((r) => r.operator === '>' || r.operator === '>=')
          .map((r) => (
            <ReferenceLine
              key={r.id}
              y={r.threshold}
              stroke={r.level === 'critical' ? '#e5484d' : '#f5a524'}
              strokeDasharray="6 4"
              label={{ value: r.level === 'critical' ? '严重' : '警告', fill: r.level === 'critical' ? '#e5484d' : '#f5a524', fontSize: 10, position: 'insideTopRight' }}
            />
          ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

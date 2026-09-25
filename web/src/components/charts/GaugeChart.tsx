/** 圆形仪表盘：自绘 SVG 半圆表盘，按告警级别着色并标出阈值刻度。 */
import type { AlertRule } from '../../types';
import { formatValue } from '../../utils/format';

interface GaugeChartProps {
  title: string;
  unit: string;
  max: number;
  decimals: number;
  value: number | null;
  rules?: AlertRule[];
  /** none 正常 / warning / critical：决定表盘颜色 */
  level?: 'none' | 'warning' | 'critical';
}

const R = 90;
const CX = 100;
const CY = 100;
const ARC = Math.PI; // 半圆

function polar(angle: number, radius = R) {
  return { x: CX + radius * Math.cos(Math.PI - angle), y: CY - radius * Math.sin(Math.PI - angle) };
}

function arcPath(start: number, end: number, radius = R): string {
  const s = polar(start, radius);
  const e = polar(end, radius);
  const largeArc = end - start > Math.PI ? 1 : 0;
  return `M ${s.x} ${s.y} A ${radius} ${radius} 0 ${largeArc} 1 ${e.x} ${e.y}`;
}

export default function GaugeChart({ title, unit, max, decimals, value, rules = [], level = 'none' }: GaugeChartProps) {
  const ratio = value === null ? 0 : Math.min(1, Math.max(0, value / max));
  const angle = ratio * ARC;
  const color = level === 'critical' ? '#e5484d' : level === 'warning' ? '#f5a524' : '#3b82f6';
  const glint = level === 'critical' ? '#ff8a8d' : level === 'warning' ? '#ffc75f' : '#7db3ff';

  // 只展示 “> / >=” 类上限阈值刻度
  const thresholdMarks = rules
    .filter((r) => r.operator === '>' || r.operator === '>=')
    .map((r) => ({ rule: r, a: Math.min(1, r.threshold / max) * ARC }));

  return (
    <div className={`gauge-wrap ${level !== 'none' ? `gauge-${level}` : ''}`}>
      <svg viewBox="0 0 200 120" className="gauge-svg">
        <path d={arcPath(0, ARC)} fill="none" stroke="#233042" strokeWidth={14} strokeLinecap="round" />
        {angle > 0.003 && (
          <path d={arcPath(0, angle)} fill="none" stroke={color} strokeWidth={14} strokeLinecap="round" style={{ transition: 'all .4s ease' }} />
        )}
        {thresholdMarks.map(({ rule, a }) => {
          const p1 = polar(a, R - 11);
          const p2 = polar(a, R + 11);
          return (
            <line
              key={rule.id}
              x1={p1.x}
              y1={p1.y}
              x2={p2.x}
              y2={p2.y}
              stroke={rule.level === 'critical' ? '#e5484d' : '#f5a524'}
              strokeWidth={2.5}
            />
          );
        })}
        <line
          x1={CX}
          y1={CY}
          x2={polar(angle, R - 22).x}
          y2={polar(angle, R - 22).y}
          stroke={glint}
          strokeWidth={3}
          style={{ transition: 'all .4s ease' }}
        />
        <circle cx={CX} cy={CY} r={5} fill={glint} />
      </svg>
      <div className="gauge-value" style={{ color }}>
        {formatValue(value, decimals, unit)}
      </div>
      <div className="gauge-title">{title}</div>
    </div>
  );
}

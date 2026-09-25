/**
 * 历史回放页：选时间区间（来自后端 24h 留存），像录像一样播放，
 * 支持暂停/继续、1x / 2x / 5x 变速、拖动进度，数据全部取自 /api/history。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import { useDashboard } from '../store/useDashboard';
import ChartCard from '../components/ChartCard';
import TrendLine from '../components/charts/TrendLine';
import GaugeChart from '../components/charts/GaugeChart';
import { formatClock, formatDateTimeLocal } from '../utils/format';
import type { HistoryResponse, MetricPoint } from '../types';

const COLORS = ['#3b82f6', '#22c55e', '#a855f7', '#f97316', '#06b6d4', '#eab308'];

// 播放速度 -> 每个动画帧代表的真实时长（ms）
const SPEED_STEP_MS: Record<number, number> = { 1: 1000, 2: 2000, 5: 5000 };
const RENDER_EVERY_MS = 120;

export default function ReplayPage() {
  const sources = useDashboard((s) => s.sources);
  const enabledDefs = sources.filter((s) => s.enabled).map((s) => s.def);

  const now = Date.now();
  const [fromInput, setFromInput] = useState(formatDateTimeLocal(now - 5 * 60 * 1000));
  const [toInput, setToInput] = useState(formatDateTimeLocal(now));
  const [selected, setSelected] = useState<string[]>([]);
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<1 | 2 | 5>(1);
  const [cursor, setCursor] = useState<number | null>(null); // 当前回放时间
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef<{ wall: number; cursor: number } | null>(null);

  useEffect(() => {
    if (sources.length && selected.length === 0) {
      setSelected(sources.filter((s) => s.enabled).slice(0, 3).map((s) => s.def.id));
    }
  }, [sources]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = async () => {
    const from = new Date(fromInput).getTime();
    const to = new Date(toInput).getTime();
    if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
      setError('时间区间无效：开始需早于结束');
      return;
    }
    if (to - from > 24 * 60 * 60 * 1000) {
      setError('回放区间不能超过 24 小时留存窗口');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.history(from, to, selected);
      setData(res);
      setCursor(from);
      setPlaying(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // 播放循环：按 wall-clock × 倍速推进游标
  useEffect(() => {
    if (!playing || !data) return;
    lastFrameRef.current = { wall: performance.now(), cursor: cursor ?? data.from };

    const tick = (wall: number) => {
      const last = lastFrameRef.current!;
      const elapsed = wall - last.wall;
      const nextCursor = last.cursor + (elapsed / 1000) * SPEED_STEP_MS[speed];
      if (nextCursor >= data.to) {
        setCursor(data.to);
        setPlaying(false);
        return;
      }
      lastFrameRef.current = { wall, cursor: nextCursor };
      setCursor(nextCursor);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [playing, speed, data]); // eslint-disable-line react-hooks/exhaustive-deps

  // 截至游标的可见点
  const visible = useMemo(() => {
    if (!data || cursor === null) return [] as { sourceId: string; name: string; color: string; points: MetricPoint[] }[];
    return selected.map((id, i) => ({
      sourceId: id,
      name: sources.find((s) => s.def.id === id)?.def.name ?? id,
      color: COLORS[i % COLORS.length],
      points: (data.series[id]?.points ?? [])
        .filter((p) => p.ts <= cursor)
        // 高密度区间下采样，保证 5x 播放时画面仍流畅
        .filter((_, idx, arr) => arr.length < 600 || idx % Math.ceil(arr.length / 600) === 0)
        .map((p) => ({ sourceId: id, ts: p.ts, value: p.value })),
    }));
  }, [data, cursor, selected, sources]);

  const toggleSource = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const totalPoints = data ? Object.values(data.series).reduce((n, s) => n + s.points.length, 0) : 0;

  return (
    <div>
      <div className="page-head">
        <h2>历史回放</h2>
        <span className="conn conn-on">数据取自后端 24 小时真实留存，不在播放时重新造数</span>
      </div>

      <ChartCard title="选择回放区间与指标">
        <div className="replay-controls">
          <label>
            开始
            <input type="datetime-local" value={fromInput} onChange={(e) => setFromInput(e.target.value)} />
          </label>
          <label>
            结束
            <input type="datetime-local" value={toInput} onChange={(e) => setToInput(e.target.value)} />
          </label>
          <div className="replay-presets">
            {([5, 15, 60] as const).map((mins) => (
              <button
                key={mins}
                type="button"
                className="btn btn-mini"
                onClick={() => {
                  setFromInput(formatDateTimeLocal(Date.now() - mins * 60 * 1000));
                  setToInput(formatDateTimeLocal(Date.now()));
                }}
              >
                近 {mins} 分钟
              </button>
            ))}
          </div>
        </div>
        <div className="replay-sources">
          {enabledDefs.map((d) => (
            <label key={d.id} className={`chip ${selected.includes(d.id) ? 'chip-on' : ''}`}>
              <input type="checkbox" checked={selected.includes(d.id)} onChange={() => toggleSource(d.id)} />
              {d.name}
            </label>
          ))}
        </div>
        {error && <div className="form-error">{error}</div>}
        <button type="button" className="btn btn-primary" onClick={load} disabled={loading || selected.length === 0}>
          {loading ? '加载中…' : '加载并播放'}
        </button>
      </ChartCard>

      {data && cursor !== null && (
        <>
          <ChartCard
            title="回放画面"
            subtitle={`${totalPoints} 个真实留存点`}
            actions={
              <div className="player">
                <button type="button" className="btn btn-mini" onClick={() => (cursor >= data.to ? (setCursor(data.from), setPlaying(true)) : setPlaying(!playing))}>
                  {playing ? '⏸ 暂停' : cursor >= data.to ? '↻ 重播' : '▶ 播放'}
                </button>
                {([1, 2, 5] as const).map((sp) => (
                  <button key={sp} type="button" className={`btn btn-mini ${speed === sp ? 'btn-primary' : ''}`} onClick={() => setSpeed(sp)}>
                    {sp}x
                  </button>
                ))}
                <span className="player-clock">
                  {formatClock(cursor)} / {formatClock(data.to)}
                </span>
              </div>
            }
          >
            <input
              className="progress"
              type="range"
              min={data.from}
              max={data.to}
              step={Math.max(RENDER_EVERY_MS, SPEED_STEP_MS[speed])}
              value={cursor}
              onChange={(e) => {
                setPlaying(false);
                setCursor(Number(e.target.value));
              }}
            />
            <div className="replay-gauges">
              {visible.map((s) => {
                const def = sources.find((x) => x.def.id === s.sourceId)?.def;
                const last = s.points[s.points.length - 1];
                return (
                  <div key={s.sourceId} className="replay-gauge">
                    <GaugeChart title={s.name} unit={def?.unit ?? ''} max={def?.max ?? 100} decimals={def?.decimals ?? 1} value={last?.value ?? null} />
                  </div>
                );
              })}
            </div>
            <TrendLine series={visible} height={320} />
          </ChartCard>
        </>
      )}
    </div>
  );
}

/**
 * 可自由布局的仪表板网格（react-grid-layout）：
 * 图表可拖动换位、拉伸改大小；布局防抖后 PUT 到后端持久化，下次进入自动恢复。
 * 布局只在挂载时从后端拉取一次；之后仅在部件集合（增/删图表）变化时增量合并，
 * 不会因为实时数据刷新而重置用户正在使用的布局。
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Responsive, WidthProvider, type Layout } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { api } from '../api/client';
import type { RGLPosition } from '../types';

type LayoutItems = Layout[];
type LayoutItem = LayoutItems[number];

const ResponsiveGrid = WidthProvider(Responsive);

interface Widget {
  key: string;
  node: ReactNode;
  default: RGLPosition;
}

interface DashboardGridProps {
  widgets: Widget[];
}

function toItem(w: Widget): LayoutItem {
  return { ...w.default, i: w.key, minW: 2, minH: 3 };
}

export default function DashboardGrid({ widgets }: DashboardGridProps) {
  // 后端保存的布局，仅挂载时拉取一次
  const savedRef = useRef<Map<string, RGLPosition> | null>(null);
  const [layout, setLayout] = useState<LayoutItems | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const keysSignature = useMemo(() => widgets.map((w) => w.key).join(','), [widgets]);

  useEffect(() => {
    let alive = true;
    api
      .getLayout()
      .then((res) => {
        if (!alive) return;
        savedRef.current = new Map((res.layout ?? []).map((p) => [p.i, p]));
      })
      .catch(() => {
        savedRef.current = new Map();
      })
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  // 部件集合变化（如某源被开/关）时增量同步：保留已有位置，新部件用保存值或默认值补齐
  useEffect(() => {
    if (!loaded) return;
    setLayout((prev) => {
      const current = prev ?? [];
      const currentKeys = new Set(current.map((p) => p.i));
      const nextKeys = new Set(widgets.map((w) => w.key));
      const kept = current.filter((p) => nextKeys.has(p.i));
      const additions = widgets
        .filter((w) => !currentKeys.has(w.key))
        .map((w) => {
          const item = toItem(w);
          const saved = savedRef.current?.get(w.key);
          return saved ? { ...item, x: saved.x, y: saved.y, w: saved.w, h: saved.h } : item;
        });
      if (additions.length === 0 && kept.length === current.length) return current;
      return [...kept, ...additions];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, keysSignature]);

  const persist = (next: LayoutItems) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await api.saveLayout(next.map((p) => ({ i: p.i, x: p.x, y: p.y, w: p.w, h: p.h })));
        setSavedAt(Date.now());
      } catch (err) {
        console.error('布局保存失败', err);
      }
    }, 700);
  };

  if (!loaded || !layout) return <div className="grid-loading">正在恢复布局…</div>;

  return (
    <div>
      <div className="grid-hint">
        按住卡片标题可<strong>拖动换位</strong>，拖右下角可<strong>拉伸大小</strong>，调整后自动保存
        {savedAt && <span className="grid-saved">（已保存 {new Date(savedAt).toLocaleTimeString('zh-CN', { hour12: false })}）</span>}
      </div>
      <ResponsiveGrid
        className="dashboard-grid"
        layouts={{ lg: layout }}
        cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
        rowHeight={72}
        margin={[14, 14]}
        isDraggable
        isResizable
        draggableHandle=".chart-card-head"
        onLayoutChange={(current: LayoutItems) => {
          setLayout(current);
          persist(current);
        }}
      >
        {widgets.map((w) => (
          <div key={w.key} className="grid-widget">
            {w.node}
          </div>
        ))}
      </ResponsiveGrid>
    </div>
  );
}

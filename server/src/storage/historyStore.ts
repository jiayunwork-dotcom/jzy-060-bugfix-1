/**
 * 历史留档存储（无第三方依赖，纯 Node 文件实现）。
 *
 * 每一路指标一个追加式 JSONL 文件 data/history/<sourceId>.jsonl，每行一个
 * { ts, value } 点；内存里保留有序数组用于区间回放查询。
 * 启动时从文件恢复；新增点高频缓冲、定时批量落盘。
 * 超过保留窗口（默认 24 小时）的点由 prune() 滚动淘汰，并压缩重写文件。
 */
import fs from 'node:fs';
import path from 'node:path';
import type { MetricPoint } from '../types';

interface PointRow {
  ts: number;
  value: number;
}

const FLUSH_INTERVAL_MS = 2000;

export class HistoryStore {
  private dir: string;
  private retentionMs: number;
  /** sourceId -> 内存中的有序点 */
  private series = new Map<string, PointRow[]>();
  /** 启动加载后文件里最后一个时间戳，只有比它新的点才需要追加写盘 */
  private loadedUpTo = new Map<string, number>();
  private dirty = new Set<string>();
  private flushTimer: NodeJS.Timeout;

  constructor(dataDir: string, retentionMs: number) {
    this.dir = path.join(dataDir, 'history');
    this.retentionMs = retentionMs;
    fs.mkdirSync(this.dir, { recursive: true });
    this.flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
    this.flushTimer.unref?.();
  }

  private fileOf(sourceId: string): string {
    return path.join(this.dir, `${sourceId}.jsonl`);
  }

  /** 注册数据源；若留档文件存在则读入并按时间排序（可容忍乱序回填）。 */
  register(sourceId: string): void {
    if (this.series.has(sourceId)) return;
    const rows: PointRow[] = [];
    try {
      const raw = fs.readFileSync(this.fileOf(sourceId), 'utf8');
      for (const line of raw.split('\n')) {
        const t = line.trim();
        if (!t) continue;
        try {
          const row = JSON.parse(t) as PointRow;
          if (Number.isFinite(row.ts) && Number.isFinite(row.value)) rows.push({ ts: row.ts, value: row.value });
        } catch {
          /* 跳过损坏行 */
        }
      }
    } catch {
      /* 文件尚不存在 */
    }
    rows.sort((a, b) => a.ts - b.ts);
    this.series.set(sourceId, rows);
    this.loadedUpTo.set(sourceId, rows.length ? rows[rows.length - 1].ts : 0);
  }

  /** 追加一个数据点（保留留档，不做任何现场重造）。 */
  add(sourceId: string, ts: number, value: number): void {
    let rows = this.series.get(sourceId);
    if (!rows) {
      this.register(sourceId);
      rows = this.series.get(sourceId)!;
    }
    const row: PointRow = { ts, value };
    // 正常路径是顺序追加；回填路径可能乱序，做有序插入。
    const last = rows[rows.length - 1];
    if (!last || ts >= last.ts) {
      rows.push(row);
    } else {
      let lo = 0;
      let hi = rows.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (rows[mid].ts < ts) lo = mid + 1;
        else hi = mid;
      }
      rows.splice(lo, 0, row);
    }
    this.dirty.add(sourceId);
  }

  addMany(sourceId: string, points: PointRow[]): void {
    for (const p of points) this.add(sourceId, p.ts, p.value);
  }

  private appendNewRows(sourceId: string): void {
    const rows = this.series.get(sourceId);
    if (!rows) return;
    const upTo = this.loadedUpTo.get(sourceId) ?? 0;
    const fresh = rows.filter((r) => r.ts > upTo);
    if (fresh.length) {
      const payload = fresh.map((r) => JSON.stringify(r)).join('\n') + '\n';
      fs.appendFileSync(this.fileOf(sourceId), payload, 'utf8');
      this.loadedUpTo.set(sourceId, fresh[fresh.length - 1].ts);
    }
  }

  /** 把缓冲点落盘（追加写）。 */
  flush(): void {
    for (const sourceId of this.dirty) {
      try {
        this.appendNewRows(sourceId);
      } catch (err) {
        // 写盘失败不拖垮实时循环，下一轮重试。
        console.error(`[history] flush ${sourceId} failed:`, (err as Error).message);
      }
    }
    this.dirty.clear();
  }

  /**
   * 滚动淘汰：删除所有源中早于 now - retentionMs 的点，并重写压缩文件。
   * 返回被删除的点数，供测试断言“超过 24 小时的旧数据被淘汰”。
   */
  prune(now: number = Date.now()): number {
    const cutoff = now - this.retentionMs;
    let removed = 0;
    for (const [sourceId, rows] of this.series) {
      let keepFrom = 0;
      while (keepFrom < rows.length && rows[keepFrom].ts < cutoff) keepFrom += 1;
      if (keepFrom === 0) continue;
      rows.splice(0, keepFrom);
      removed += keepFrom;
      this.rewriteFile(sourceId);
      this.loadedUpTo.set(sourceId, rows.length ? rows[rows.length - 1].ts : 0);
    }
    return removed;
  }

  /** 立即重写压缩某个源（或全部源）的留档文件，保证磁盘与内存一致。 */
  compact(sourceIds?: string[]): void {
    const targets = sourceIds ?? [...this.series.keys()];
    for (const id of targets) {
      if (this.series.has(id)) this.rewriteFile(id);
    }
  }

  private rewriteFile(sourceId: string): void {
    const rows = this.series.get(sourceId) ?? [];
    const file = this.fileOf(sourceId);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, rows.map((r) => JSON.stringify(r)).join(rows.length ? '\n' : '') + (rows.length ? '\n' : ''), 'utf8');
    fs.renameSync(tmp, file);
    this.dirty.delete(sourceId);
    if (rows.length) this.loadedUpTo.set(sourceId, rows[rows.length - 1].ts);
  }

  /** 区间回放：取 [from, to] 内真实留存的点（含端点）。 */
  query(sourceId: string, from: number, to: number): MetricPoint[] {
    const rows = this.series.get(sourceId) ?? [];
    const out: MetricPoint[] = [];
    for (const r of rows) {
      if (r.ts < from) continue;
      if (r.ts > to) break;
      out.push({ sourceId, ts: r.ts, value: r.value });
    }
    return out;
  }

  latest(sourceId: string): MetricPoint | null {
    const rows = this.series.get(sourceId) ?? [];
    const last = rows[rows.length - 1];
    return last ? { sourceId, ts: last.ts, value: last.value } : null;
  }

  latestAll(): MetricPoint[] {
    const out: MetricPoint[] = [];
    for (const [sourceId, rows] of this.series) {
      const last = rows[rows.length - 1];
      if (last) out.push({ sourceId, ts: last.ts, value: last.value });
    }
    return out;
  }

  count(sourceId: string): number {
    return this.series.get(sourceId)?.length ?? 0;
  }

  /** 测试辅助：查看磁盘文件中现存多少行（含重启后仍在的证据）。 */
  countOnDisk(sourceId: string): number {
    try {
      const raw = fs.readFileSync(this.fileOf(sourceId), 'utf8');
      return raw.split('\n').filter((l) => l.trim().length > 0).length;
    } catch {
      return 0;
    }
  }

  close(): void {
    clearInterval(this.flushTimer);
    this.flush();
  }
}

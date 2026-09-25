/**
 * 仅测试环境开放的维护接口（ENABLE_TEST_API=true）。
 * 让自动化测试可以确定性地注入数据点、批量回填历史并立即触发淘汰，
 * 而无需依赖随机模拟时序。生产编排里该开关为 false。
 */
import type { FastifyInstance } from 'fastify';
import type { MetricPoint } from '../types';
import type { Runtime } from '../runtime';

interface IngestBody {
  points?: Array<{ sourceId?: unknown; ts?: unknown; value?: unknown }>;
}

interface PruneBody {
  now?: unknown;
  compact?: unknown;
}

interface FaultBody {
  sourceId?: unknown;
  ticks?: unknown;
}

function parsePoints(body: IngestBody, rt: Runtime): { ok: true; points: MetricPoint[] } | { ok: false; message: string } {
  if (!Array.isArray(body.points) || body.points.length === 0) {
    return { ok: false, message: 'points 必须是非空数组' };
  }
  const points: MetricPoint[] = [];
  for (const p of body.points) {
    const sourceId = String(p.sourceId ?? '');
    if (!rt.registry.get(sourceId)) return { ok: false, message: `未知数据源: ${sourceId}` };
    const ts = p.ts === undefined ? Date.now() : Number(p.ts);
    const value = Number(p.value);
    if (!Number.isFinite(ts) || !Number.isFinite(value)) return { ok: false, message: 'ts/value 必须是数字' };
    points.push({ sourceId, ts, value });
  }
  return { ok: true, points };
}

export default async function testRoutes(app: FastifyInstance, rt: Runtime): Promise<void> {
  // 确定性地注入若干点（走与真实节拍完全相同的留档+告警+推送管线）
  app.post<{ Body: IngestBody }>('/test/ingest', async (req, reply) => {
    const parsed = parsePoints(req.body ?? {}, rt);
    if (!parsed.ok) return reply.code(400).send({ error: 'invalid_points', message: parsed.message });
    const events = rt.ingestPoints(parsed.points);
    return reply.code(201).send({ ingested: parsed.points, events });
  });

  // 立即按保留窗口滚动淘汰；compact=true 时同步重写压缩磁盘文件
  app.post<{ Body: PruneBody }>('/test/prune', async (req) => {
    const now = req.body?.now === undefined ? Date.now() : Number(req.body.now);
    const removed = rt.history.prune(now);
    if (req.body?.compact !== false) rt.history.compact();
    const counts: Record<string, number> = {};
    for (const s of rt.registry.list()) counts[s.def.id] = rt.history.count(s.def.id);
    return { removed, counts, now };
  });

  // 强制某源从下一拍起进入采集异常（不产点、状态置 error），确定性验证异常路径
  app.post<{ Body: FaultBody }>('/test/fault', async (req, reply) => {
    const sourceId = String(req.body?.sourceId ?? '');
    if (!rt.registry.get(sourceId)) return reply.code(400).send({ error: 'invalid_source', message: `未知数据源: ${sourceId}` });
    const raw = Number(req.body?.ticks);
    const ticks = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : undefined;
    rt.simulator.forceFault(sourceId, ticks);
    return { ok: true, sourceId };
  });

  // 立即执行一个采集节拍（不等定时器），与故障注入配合可确定性驱动异常转换
  app.post('/test/tick', async () => ({ points: rt.runTick() }));

  // 查询内存与磁盘计数，供测试核对落盘
  app.get('/test/debug', async () => {
    const counts: Record<string, { memory: number; disk: number; latestTs: number | null }> = {};
    for (const s of rt.registry.list()) {
      const latest = rt.history.latest(s.def.id);
      counts[s.def.id] = { memory: rt.history.count(s.def.id), disk: rt.history.countOnDisk(s.def.id), latestTs: latest?.ts ?? null };
    }
    return { tickMs: rt.config.tickMs, retentionMs: rt.config.retentionMs, counts };
  });
}

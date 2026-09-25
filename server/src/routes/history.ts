/** 历史留档与回放路由：区间查询返回后端真实留存的数据点。 */
import type { FastifyInstance } from 'fastify';
import type { Runtime } from '../runtime';

interface HistoryQuery {
  from?: string;
  to?: string;
  sources?: string;
}

export default async function historyRoutes(app: FastifyInstance, rt: Runtime): Promise<void> {
  app.get<{ Querystring: HistoryQuery }>('/history', async (req, reply) => {
    const to = req.query.to ? Number(req.query.to) : Date.now();
    // 默认回放最近 5 分钟
    const from = req.query.from ? Number(req.query.from) : to - 5 * 60 * 1000;
    if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) {
      return reply.code(400).send({ error: 'invalid_range', message: 'from/to 必须是毫秒时间戳且 from <= to' });
    }
    const all = rt.registry.list().map((s) => s.def.id);
    const wanted = req.query.sources ? req.query.sources.split(',').map((s) => s.trim()).filter(Boolean) : all;
    const unknown = wanted.filter((id) => !rt.registry.get(id));
    if (unknown.length) return reply.code(400).send({ error: 'unknown_sources', sources: unknown });

    const series: Record<string, { sourceId: string; points: { ts: number; value: number }[] }> = {};
    for (const id of wanted) {
      series[id] = { sourceId: id, points: rt.history.query(id, from, to) };
    }
    return { from, to, tickMs: rt.config.tickMs, series };
  });
}

/** 数据源管理路由：列表 / 详情 / 手动开关采集。 */
import type { FastifyInstance } from 'fastify';
import type { Runtime } from '../runtime';

interface SourceIdParam {
  id: string;
}

export default async function sourceRoutes(app: FastifyInstance, rt: Runtime): Promise<void> {
  app.get('/sources', async () => rt.registry.list());

  app.get<{ Params: SourceIdParam }>('/sources/:id', async (req, reply) => {
    const s = rt.registry.get(req.params.id);
    if (!s) return reply.code(404).send({ error: 'source_not_found' });
    return s;
  });

  // 手动开/关某一路源的采集；关闭后不再产生新的数据点，
  // 且该源名下正在激活的告警立即解除（随快照/告警事件推送撤销界面提醒）
  app.put<{ Params: SourceIdParam; Body: { enabled?: boolean } }>('/sources/:id/enabled', async (req, reply) => {
    const enabled = req.body?.enabled;
    if (typeof enabled !== 'boolean') {
      return reply.code(400).send({ error: 'invalid_body', message: 'body.enabled 必须是布尔值' });
    }
    const s = rt.setSourceEnabled(req.params.id, enabled);
    if (!s) return reply.code(404).send({ error: 'source_not_found' });
    rt.broadcastSource(s);
    rt.hub.broadcast(rt.buildSnapshot());
    return s;
  });
}

/** 布局持久化路由：用户拖拽/拉伸后的面板布局原样存取。 */
import type { FastifyInstance } from 'fastify';
import type { LayoutConfig } from '../types';
import type { Runtime } from '../runtime';

export default async function layoutRoutes(app: FastifyInstance, rt: Runtime): Promise<void> {
  app.get('/layout', async () => ({ layout: rt.configStore.getLayout() }));

  app.put<{ Body: { layout?: unknown } }>('/layout', async (req, reply) => {
    const layout = req.body?.layout;
    if (!Array.isArray(layout)) {
      return reply.code(400).send({ error: 'invalid_layout', message: 'layout 必须是数组' });
    }
    rt.configStore.saveLayout(layout as LayoutConfig);
    return { ok: true, layout: rt.configStore.getLayout() };
  });
}

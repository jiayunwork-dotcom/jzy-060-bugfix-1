/** WebSocket 长连接：建连即下发全量快照，之后由服务端持续主动推送。 */
import type { FastifyInstance } from 'fastify';
import type { Runtime } from '../runtime';

export default async function realtimeRoutes(app: FastifyInstance, rt: Runtime): Promise<void> {
  app.get('/ws', { websocket: true }, (socket) => {
    rt.hub.add(socket);
    // 新连接立刻收到一份快照：源状态 / 规则 / 激活告警 / 最新值
    rt.hub.send(socket, rt.buildSnapshot());
  });
}

/**
 * 应用装配：Fastify + WebSocket + REST 路由 + 前端静态托管。
 * 通过 createApp 注入 Runtime，便于测试对同一实例发请求。
 */
import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import type { AppConfig } from './config';
import { Runtime } from './runtime';
import sourceRoutes from './routes/sources';
import alertRoutes from './routes/alerts';
import historyRoutes from './routes/history';
import layoutRoutes from './routes/layout';
import realtimeRoutes from './routes/realtime';
import testRoutes from './routes/test';

export interface CreateServerOptions {
  startRuntime?: boolean;
}

export async function createApp(config: AppConfig, options: CreateServerOptions = {}) {
  const app = Fastify({ logger: { transport: undefined } });
  app.log.level = process.env.LOG_LEVEL || 'info';

  await app.register(websocket);

  const rt = new Runtime(config);
  app.decorate('runtime', rt);

  app.get('/api/health', async () => ({ ok: true, ts: Date.now(), tickMs: config.tickMs }));

  await app.register(
    async (api) => {
      await api.register((a) => sourceRoutes(a, rt));
      await api.register((a) => alertRoutes(a, rt));
      await api.register((a) => historyRoutes(a, rt));
      await api.register((a) => layoutRoutes(a, rt));
      await api.register((a) => realtimeRoutes(a, rt));
      if (config.enableTestApi) {
        app.log.warn('测试专用接口已开启（ENABLE_TEST_API=true），请勿在生产打开');
        await api.register((a) => testRoutes(a, rt));
      }
    },
    { prefix: '/api' },
  );

  // 前端构建产物存在时由后端一体托管（SPA 回退到 index.html）
  if (config.webDist && fs.existsSync(path.join(config.webDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: path.resolve(config.webDist), prefix: '/' });
    app.setNotFoundHandler((req, reply) => {
      if (req.raw.url?.startsWith('/api/')) {
        return reply.code(404).send({ error: 'not_found' });
      }
      return reply.sendFile('index.html');
    });
  }

  if (options.startRuntime !== false) rt.start();

  return { app, rt };
}

/**
 * 额外锁定：实时数据确实由“服务端通过 WebSocket 主动推送”，而非前端轮询。
 * 客户端只建连、不发任何请求，断言在无轮询的情况下持续收到 metrics 帧。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket as WS } from 'ws';
import { api, startServer, type TestServer, waitForWsMessage } from './helpers/server';

describe('WebSocket 服务端主动推送', () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startServer({ tickMs: 200 });
  });
  afterAll(async () => {
    await server.stop();
  });

  it('建连即收到全量快照', async () => {
    const snap = await waitForWsMessage(
      server.baseUrl.replace('http', 'ws') + '/api/ws',
      (msg) => msg.type === 'snapshot',
      5000,
    );
    expect(snap.sources.length).toBeGreaterThanOrEqual(6);
    expect(Array.isArray(snap.rules)).toBe(true);
  });

  it('不发任何请求也能连续收到多批 metrics 推送', async () => {
    const counts: Record<string, number> = {};
    await new Promise<void>((resolve, reject) => {
      const ws = new WS(server.baseUrl.replace('http', 'ws') + '/api/ws');
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error('未在时限内收到足够的推送'));
      }, 5000);
      ws.on('message', (data: Buffer) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'metrics') {
          for (const p of msg.points) counts[p.sourceId] = (counts[p.sourceId] ?? 0) + 1;
        }
        const total = Object.values(counts).reduce((a: number, b) => a + b, 0);
        if (total >= 12) {
          clearTimeout(timer);
          ws.close();
          resolve();
        }
      });
      ws.on('error', reject);
    });
    // 六个源至少都被推到一次
    const sources = (await api(server, '/sources')).body.filter((s: any) => s.enabled).map((s: any) => s.def.id);
    for (const id of sources) expect(counts[id]).toBeGreaterThan(0);
  });
});

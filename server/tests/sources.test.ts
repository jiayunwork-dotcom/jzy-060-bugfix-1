/**
 * 行为 1：数据源被手动关闭后不再新增数据点；重新打开后恢复推送。
 * 通过 HTTP 开关 + /api/history 留存计数与 WebSocket 实时消息联合判定。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, sleep, startServer, type TestServer, waitForWsMessage } from './helpers/server';

describe('数据源开关', () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await startServer({ tickMs: 200 });
  });
  afterAll(async () => {
    await server.stop();
  });

  it('初始状态为全部开启且正在产出点', async () => {
    const { status, body } = await api(server, '/sources');
    expect(status).toBe(200);
    const cpu = body.find((s: any) => s.def.id === 'cpu');
    expect(cpu.enabled).toBe(true);

    await waitForWsMessage(
      server.baseUrl.replace('http', 'ws') + '/api/ws',
      (msg) => msg.type === 'metrics' && msg.points.some((p: any) => p.sourceId === 'cpu'),
      5000,
    );
  });

  it('关闭后该源不再产生新数据点，其它源不受影响', async () => {
    const disable = await api(server, '/sources/network/enabled', {
      method: 'PUT',
      body: JSON.stringify({ enabled: false }),
    });
    expect(disable.status).toBe(200);
    expect(disable.body.enabled).toBe(false);

    // 等待若干个采集节拍
    await sleep(1200);

    const range = await api(server, `/history?from=0&to=${Date.now()}&sources=network,cpu`);
    const latestNetworkTs = range.body.series.network.points.at(-1)?.ts ?? 0;
    const latestCpuTs = range.body.series.cpu.points.at(-1)?.ts ?? 0;
    const afterDisable = Date.now();

    // network 在关闭之后不应再有点（给 1 个节拍的时间误差）
    expect(latestNetworkTs).toBeLessThan(afterDisable - 900);
    // cpu 仍在持续产出
    expect(latestCpuTs).toBeGreaterThan(afterDisable - 1500);
  });

  it('关闭状态持久化，服务仍认为该源 disabled', async () => {
    const { body } = await api(server, '/sources/network');
    expect(body.enabled).toBe(false);
  });

  it('重新打开后恢复推送新数据点', async () => {
    const before = Date.now();
    const enable = await api(server, '/sources/network/enabled', {
      method: 'PUT',
      body: JSON.stringify({ enabled: true }),
    });
    expect(enable.body.enabled).toBe(true);

    // 实时长连接上应再次收到 network 的点
    await waitForWsMessage(
      server.baseUrl.replace('http', 'ws') + '/api/ws',
      (msg) => msg.type === 'metrics' && msg.points.some((p: any) => p.sourceId === 'network' && p.ts >= before),
      5000,
    );

    const range = await api(server, `/history?from=${before}&to=${Date.now()}&sources=network`);
    expect(range.body.series.network.points.length).toBeGreaterThan(0);
  });
});

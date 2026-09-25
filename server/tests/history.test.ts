/**
 * 行为 4：历史回放取到的是所选区间内后端真实留存的点，而非当场重造。
 * 做法：关掉一路源杜绝新点 -> 注入带显式时间戳与取值的点 -> 区间查询，
 * 逐点比对 ts/value，并验证区间外的点不会混进来、重复查询结果稳定不变。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, startServer, type TestServer } from './helpers/server';

describe('历史回放', () => {
  let server: TestServer;
  const sourceId = 'rps';

  beforeAll(async () => {
    server = await startServer({ tickMs: 100000 }); // 停止实时造数，保证区间里只有注入点
    const off = await api(server, `/sources/${sourceId}/enabled`, {
      method: 'PUT',
      body: JSON.stringify({ enabled: false }),
    });
    expect(off.body.enabled).toBe(false);
  });

  afterAll(async () => {
    await server.stop();
  });

  it('回放返回的点与注入留档逐点一致，且不包含区间外数据', async () => {
    const t0 = 1_700_000_000_000; // 固定基准时间
    const injected = Array.from({ length: 10 }, (_, i) => ({
      sourceId,
      ts: t0 + i * 1000,
      value: 100 + i * 7, // 独特取值，便于确认不是现造的随机值
    }));
    const outside = [
      { sourceId, ts: t0 - 5000, value: 9999 },
      { sourceId, ts: t0 + 20_000, value: 8888 },
    ];
    const r = await api(server, '/test/ingest', {
      method: 'POST',
      body: JSON.stringify({ points: [...injected, ...outside] }),
    });
    expect(r.status).toBe(201);

    const from = t0 - 1;
    const to = t0 + 9 * 1000 + 1;
    const q1 = await api(server, `/history?from=${from}&to=${to}&sources=${sourceId}`);
    expect(q1.status).toBe(200);
    const points = q1.body.series[sourceId].points;

    // 逐点比对：真实留存，不是重新造的
    expect(points).toHaveLength(injected.length);
    points.forEach((p: any, i: number) => {
      expect(p.ts).toBe(injected[i].ts);
      expect(p.value).toBe(injected[i].value);
    });
    expect(points.some((p: any) => p.value === 9999 || p.value === 8888)).toBe(false);

    // 再查一次结果完全一致（无现场重造、无追加）
    const q2 = await api(server, `/history?from=${from}&to=${to}&sources=${sourceId}`);
    expect(q2.body.series[sourceId].points).toEqual(points);
  });

  it('边界包含端点，空区间返回空数组而不是模拟数据', async () => {
    const t0 = 1_700_001_000_000;
    await api(server, '/test/ingest', {
      method: 'POST',
      body: JSON.stringify({ points: [{ sourceId, ts: t0, value: 424 }] }),
    });
    const exact = await api(server, `/history?from=${t0}&to=${t0}&sources=${sourceId}`);
    expect(exact.body.series[sourceId].points).toEqual([{ sourceId, ts: t0, value: 424 }]);

    const empty = await api(server, `/history?from=${t0 + 1}&to=${t0 + 9999}&sources=${sourceId}`);
    expect(empty.body.series[sourceId].points).toEqual([]);
  });

  it('非法区间与未知数据源返回 400', async () => {
    const badRange = await api(server, `/history?from=100&to=50&sources=${sourceId}`);
    expect(badRange.status).toBe(400);
    const badSource = await api(server, '/history?from=0&to=1&sources=nope');
    expect(badSource.status).toBe(400);
  });
});
